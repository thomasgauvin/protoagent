import { EventEmitter } from 'node:events';
import { OpenAI } from 'openai';
import { z } from 'zod';
import { ApiError } from './errors.js';
import { runAgenticLoop, type AgentEvent, type Message } from '../agentic-loop.js';
import { readConfig, resolveApiKey, type Config } from '../config-core.js';
import { interjectMessage, enqueueMessage, getNextQueued, clearMessageQueue, loadQueueFromSession, getQueueForSession } from '../message-queue.js';
import { closeMcp, getMcpConnectionStatus, initializeMcp, reconnectAllMcp } from '../mcp.js';
import { getModelPricing, getProvider, getRequestDefaultParams } from '../providers.js';
import { loadRuntimeConfig } from '../runtime-config.js';
import {
  createSession,
  deleteSession as deleteStoredSession,
  ensureSystemPromptAtTop,
  generateTitle,
  listSessions as listStoredSessions,
  loadSession,
  saveSession,
  type Session,
} from '../sessions.js';
import { activateSkill, loadSkills } from '../skills.js';
import { defaultRegistry } from '../tools/registry.js';
import { clearTodos, getTodosForSession, setTodosForSession, type TodoItem } from '../tools/todo.js';
import { setDangerouslySkipPermissions } from '../utils/approval-state.js';
import { ApprovalManager, type ApprovalRequest, type ApprovalResponse } from '../utils/approval-manager.js';
import { parseInputWithImages } from '../utils/image-utils.js';
import { logger } from '../utils/logger.js';
import { generateSystemPrompt } from '../system-prompt.js';
import { CronWorkflow } from '../workflow/cron-workflow.js';
import { LoopWorkflow } from '../workflow/loop-workflow.js';
import { WorkflowManager } from '../workflow/manager.js';
import { ToolRegistry } from '../tools/registry.js';
import type { WorkflowType } from '../workflow/types.js';

const workflowTypeSchema = z.enum(['queue', 'loop', 'cron']);

export function definedProps<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

function buildClient(config: Config): OpenAI {
  const provider = getProvider(config.provider);
  const apiKey = resolveApiKey(config);
  if (!apiKey) {
    const providerName = provider?.name || config.provider;
    const envVar = provider?.apiKeyEnvVar;
    throw new Error(
      envVar
        ? `Missing API key for ${providerName}. Set it in config or export ${envVar}.`
        : `Missing API key for ${providerName}.`,
    );
  }

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey };
  const baseURLOverride = process.env.PROTOAGENT_BASE_URL?.trim();
  const baseURL = baseURLOverride || provider?.baseURL;
  if (baseURL) clientOptions.baseURL = baseURL;

  const rawHeaders = process.env.PROTOAGENT_CUSTOM_HEADERS?.trim();
  if (rawHeaders) {
    const defaultHeaders: Record<string, string> = {};
    for (const line of rawHeaders.split('\n')) {
      const separator = line.indexOf(': ');
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 2).trim();
      if (key && value) defaultHeaders[key] = value;
    }
    if (Object.keys(defaultHeaders).length > 0) {
      clientOptions.defaultHeaders = defaultHeaders;
    }
  } else if (provider?.headers && Object.keys(provider.headers).length > 0) {
    clientOptions.defaultHeaders = provider.headers;
  }

  return new OpenAI(clientOptions);
}

export interface ApiRuntimeOptions {
  dangerouslySkipPermissions?: boolean;
}

export interface ApiRuntimeDependencies {
  loadRuntimeConfig: typeof loadRuntimeConfig;
  readConfig: typeof readConfig;
  createClient: typeof buildClient;
  initializeMcp: typeof initializeMcp;
  closeMcp: typeof closeMcp;
  reconnectAllMcp: typeof reconnectAllMcp;
  getMcpConnectionStatus: typeof getMcpConnectionStatus;
  createSession: typeof createSession;
  deleteStoredSession: typeof deleteStoredSession;
  listStoredSessions: typeof listStoredSessions;
  loadSession: typeof loadSession;
  saveSession: typeof saveSession;
  activateSkill: typeof activateSkill;
  loadSkills: typeof loadSkills;
  parseInputWithImages: typeof parseInputWithImages;
  generateSystemPrompt: typeof generateSystemPrompt;
  runAgenticLoop: typeof runAgenticLoop;
  getModelPricing: typeof getModelPricing;
  getRequestDefaultParams: typeof getRequestDefaultParams;
  generateTitle: typeof generateTitle;
  toolRegistry: ToolRegistry;
}

const defaultDependencies: ApiRuntimeDependencies = {
  loadRuntimeConfig,
  readConfig,
  createClient: buildClient,
  initializeMcp,
  closeMcp,
  reconnectAllMcp,
  getMcpConnectionStatus,
  createSession,
  deleteStoredSession,
  listStoredSessions,
  loadSession,
  saveSession,
  activateSkill,
  loadSkills,
  parseInputWithImages,
  generateSystemPrompt,
  runAgenticLoop,
  getModelPricing,
  getRequestDefaultParams,
  generateTitle,
  toolRegistry: defaultRegistry,
};

export interface ApiApproval {
  id: string;
  type: ApprovalRequest['type'];
  description: string;
  detail?: string;
  sessionId?: string;
  createdAt: string;
}

export interface ApiEvent<T = unknown> {
  type: string;
  sessionId: string;
  timestamp: string;
  data: T;
}

interface PendingApproval {
  approval: ApiApproval;
  resolve: (response: ApprovalResponse) => void;
}

export interface SessionSnapshot extends Session {
  active: boolean;
  running: boolean;
}

export class ApiRuntime {
  private readonly events = new EventEmitter();
  private readonly approvalManager = new ApprovalManager();
  private readonly activeSkills = new Map<string, string>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly options: ApiRuntimeOptions;
  private readonly deps: ApiRuntimeDependencies;

  private initialized = false;
  private initializePromise: Promise<void> | null = null;
  private config: Config | null = null;
  private client: OpenAI | null = null;
  private activeSession: Session | null = null;
  private completionMessages: Message[] = [];
  private pendingInterjects: ReturnType<typeof interjectMessage>[] = [];
  private workflowManager: WorkflowManager | null = null;
  private totalCost = 0;
  private abortController: AbortController | null = null;
  private activeRunPromise: Promise<void> | null = null;
  private abortRequested = false;

  constructor(options: ApiRuntimeOptions = {}, dependencies: Partial<ApiRuntimeDependencies> = {}) {
    this.options = options;
    this.deps = { ...defaultDependencies, ...dependencies };
    this.events.setMaxListeners(0);
    setDangerouslySkipPermissions(Boolean(options.dangerouslySkipPermissions));
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializePromise) return this.initializePromise;

    this.initializePromise = this.doInitialize();
    return this.initializePromise;
  }

  private async doInitialize(): Promise<void> {
    await this.deps.loadRuntimeConfig();

    const config = this.deps.readConfig('active');
    if (!config) {
      throw new Error('No config found. Run: protoagent configure --provider <id> --model <id> --api-key <key>');
    }

    this.config = config;
    this.client = this.deps.createClient(config);
    this.workflowManager = this.createWorkflowManager();

    this.approvalManager.setApprovalHandler(async (request) => {
      const approvalId = this.createApprovalId(request.id);
      const approval: ApiApproval = {
        id: approvalId,
        type: request.type,
        description: request.description,
        detail: request.detail,
        sessionId: request.sessionId,
        createdAt: new Date().toISOString(),
      };

      return new Promise((resolve) => {
        this.pendingApprovals.set(approvalId, { approval, resolve });
        if (approval.sessionId) {
          this.emitSessionEvent(approval.sessionId, 'approval_required', approval);
        }
      });
    });

    await this.deps.initializeMcp();
    this.initialized = true;
  }

  async close(): Promise<void> {
    this.resolveAllPendingApprovals('reject');
    await this.abortCurrentLoop();
    await this.deps.closeMcp();
  }

  subscribe(sessionId: string, listener: (event: ApiEvent) => void): () => void {
    const channel = this.getEventChannel(sessionId);
    this.events.on(channel, listener);
    return () => {
      this.events.off(channel, listener);
    };
  }

  async listSessions(): Promise<{ sessions: Awaited<ReturnType<typeof listStoredSessions>>; activeSessionId: string | null; running: boolean }> {
    await this.initialize();
    const sessions = await this.deps.listStoredSessions();
    return {
      sessions,
      activeSessionId: this.activeSession?.id ?? null,
      running: this.isRunning(),
    };
  }

  async createAndActivateSession(): Promise<SessionSnapshot> {
    await this.initialize();
    const config = this.requireConfig();
    const systemPrompt = await this.buildCurrentSystemPrompt();
    const session = this.deps.createSession(config.model, config.provider);
    session.completionMessages = [{ role: 'system', content: systemPrompt } as Message];
    clearTodos(session.id);
    clearMessageQueue(session.id);
    await this.deps.saveSession(session);
    await this.activateSession(session);
    return this.getActiveSessionSnapshot();
  }

  async getSession(sessionId: string): Promise<SessionSnapshot> {
    await this.initialize();
    const session = await this.loadExistingSession(sessionId);
    await this.activateSession(session);
    return this.getActiveSessionSnapshot();
  }

  async getSessionSnapshot(sessionId: string): Promise<SessionSnapshot> {
    await this.initialize();
    if (this.activeSession?.id === sessionId) {
      return this.getActiveSessionSnapshot();
    }

    const session = await this.loadExistingSession(sessionId);
    return {
      ...session,
      active: false,
      running: false,
    };
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    await this.initialize();

    if (this.activeSession?.id === sessionId) {
      await this.abortCurrentLoop();
      this.activeSession = null;
      this.completionMessages = [];
      this.pendingInterjects = [];
      this.totalCost = 0;
      this.workflowManager = this.createWorkflowManager();
    }

    return this.deps.deleteStoredSession(sessionId);
  }

  async sendMessage(
    sessionId: string,
    content: string,
    mode: 'send' | 'queue' = 'send',
  ): Promise<{ status: 'started' | 'queued' | 'interjected'; session: SessionSnapshot }> {
    await this.initialize();

    const trimmed = content.trim();
    if (!trimmed) {
      throw new ApiError(400, 'Message content cannot be empty.');
    }

    const session = await this.loadExistingSession(sessionId);
    await this.activateSession(session);

    if (mode === 'queue') {
      enqueueMessage(trimmed, sessionId);
      await this.persistActiveSession();
      this.emitSessionEvent(sessionId, 'message_queued', { mode: 'queue', content: trimmed });
      if (!this.activeRunPromise) {
        const next = getNextQueued(sessionId);
        if (next) {
          this.startRunSequence(sessionId, next.content);
          return { status: 'started', session: this.getActiveSessionSnapshot() };
        }
      }
      return { status: 'queued', session: this.getActiveSessionSnapshot() };
    }

    if (this.activeRunPromise) {
      this.pendingInterjects.push(interjectMessage(trimmed, sessionId));
      await this.persistActiveSession();
      this.emitSessionEvent(sessionId, 'message_queued', { mode: 'interject', content: trimmed });
      return { status: 'interjected', session: this.getActiveSessionSnapshot() };
    }

    this.startRunSequence(sessionId, trimmed);
    return { status: 'started', session: this.getActiveSessionSnapshot() };
  }

  async abortCurrentLoop(): Promise<{ aborted: boolean }> {
    await this.initialize();

    if (!this.activeRunPromise) {
      return { aborted: false };
    }

    this.abortRequested = true;
    this.abortController?.abort();
    this.resolveAllPendingApprovals('reject');

    try {
      await this.activeRunPromise;
    } catch (error) {
      logger.warn('Run aborted with error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { aborted: true };
  }

  listApprovals(): ApiApproval[] {
    return Array.from(this.pendingApprovals.values())
      .map((entry) => entry.approval)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async resolveApproval(id: string, decision: ApprovalResponse): Promise<ApiApproval | null> {
    await this.initialize();

    const pending = this.pendingApprovals.get(id);
    if (!pending) return null;

    this.pendingApprovals.delete(id);
    pending.resolve(decision);

    if (pending.approval.sessionId) {
      this.emitSessionEvent(pending.approval.sessionId, 'approval_resolved', {
        id,
        decision,
      });
    }

    return pending.approval;
  }

  getWorkflow() {
    const workflowManager = this.requireActiveWorkflowManager();
    const currentType = workflowManager.getCurrentType();
    const base = {
      state: workflowManager.getState(),
      info: workflowManager.getWorkflowInfo(),
      activeSessionId: this.activeSession?.id ?? null,
    };

    if (currentType === 'loop') {
      const workflow = workflowManager.getCurrentWorkflow() as LoopWorkflow;
      return {
        ...base,
        loop: {
          config: workflow.getConfig(),
          progress: workflow.getProgress(),
        },
      };
    }

    if (currentType === 'cron') {
      return {
        ...base,
        cron: workflowManager.getCronState(),
      };
    }

    return base;
  }

  async switchWorkflow(type: WorkflowType) {
    const workflowManager = this.requireActiveWorkflowManager();
    workflowManager.switchWorkflow(workflowTypeSchema.parse(type));
    await this.persistActiveSession();
    this.emitWorkflowUpdated();
    return this.getWorkflow();
  }

  async startWorkflow(input: {
    type?: WorkflowType;
    loopInstructions?: string;
    endCondition?: string;
    maxIterations?: number;
    cronSchedule?: string;
    cronPrompt?: string;
  } = {}) {
    const workflowManager = this.requireActiveWorkflowManager();
    if (input.type) {
      workflowManager.switchWorkflow(workflowTypeSchema.parse(input.type));
    }

    const currentType = workflowManager.getCurrentType();
    if (currentType === 'loop') {
      const loopWorkflow = workflowManager.getCurrentWorkflow() as LoopWorkflow;
      loopWorkflow.updateConfig({
        workPrompt: input.loopInstructions,
        closingConditionPrompt: input.endCondition,
        maxIterations: input.maxIterations,
      });
      workflowManager.start(definedProps({
        loopInstructions: input.loopInstructions,
        endCondition: input.endCondition,
      }));
    } else if (currentType === 'cron') {
      const cronWorkflow = workflowManager.getCurrentWorkflow() as CronWorkflow;
      if (input.cronSchedule && input.cronPrompt) {
        cronWorkflow.setSchedule(input.cronSchedule, input.cronPrompt);
      }
      workflowManager.start(definedProps({
        cronSchedule: input.cronSchedule,
        cronPrompt: input.cronPrompt,
      }));
    } else {
      workflowManager.start();
    }

    await this.persistActiveSession();
    this.emitWorkflowUpdated();
    return this.getWorkflow();
  }

  async stopWorkflow() {
    const workflowManager = this.requireActiveWorkflowManager();
    workflowManager.stop();
    await this.persistActiveSession();
    this.emitWorkflowUpdated();
    return this.getWorkflow();
  }

  getTodos(): TodoItem[] {
    const session = this.requireActiveSession();
    return getTodosForSession(session.id);
  }

  async updateTodos(todos: TodoItem[]): Promise<TodoItem[]> {
    const session = this.requireActiveSession();
    setTodosForSession(session.id, todos);
    await this.persistActiveSession();
    this.emitSessionEvent(session.id, 'todos_updated', { todos });
    return this.getTodos();
  }

  async listSkills() {
    await this.initialize();
    const skills = await this.deps.loadSkills();
    return skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      source: skill.source,
      location: skill.location,
      active: this.activeSkills.has(skill.name),
    }));
  }

  async activateSkillByName(name: string) {
    await this.initialize();
    const content = await this.deps.activateSkill(name);
    if (content.startsWith('Error:')) {
      throw new ApiError(
        content.includes('Unknown skill') ? 404 : 400,
        content,
      );
    }

    this.activeSkills.set(name, content);
    if (this.activeSession) {
      await this.refreshActiveSessionSystemPrompt();
      await this.persistActiveSession();
      this.emitSessionEvent(this.activeSession.id, 'skills_updated', {
        activeSkills: Array.from(this.activeSkills.keys()),
      });
    }

    return {
      name,
      content,
      activeSkills: Array.from(this.activeSkills.keys()),
    };
  }

  getMcpStatus() {
    return this.deps.getMcpConnectionStatus();
  }

  async reconnectMcp() {
    await this.initialize();
    await this.deps.reconnectAllMcp();
    return this.getMcpStatus();
  }

  private async activateSession(session: Session): Promise<void> {
    if (this.activeSession?.id === session.id) {
      this.completionMessages = ensureSystemPromptAtTop(
        this.completionMessages,
        await this.buildCurrentSystemPrompt(),
      );
      this.activeSession.completionMessages = this.completionMessages;
      await this.persistActiveSession();
      return;
    }

    if (this.activeRunPromise) {
      await this.abortCurrentLoop();
    }

    if (this.activeSession) {
      await this.persistActiveSession();
    }

    this.activeSession = session;
    this.totalCost = typeof session.totalCost === 'number' ? session.totalCost : 0;
    this.pendingInterjects = Array.isArray(session.interjectMessages)
      ? [...session.interjectMessages]
      : [];
    this.completionMessages = ensureSystemPromptAtTop(
      Array.isArray(session.completionMessages) ? session.completionMessages : [],
      await this.buildCurrentSystemPrompt(),
    );

    setTodosForSession(session.id, Array.isArray(session.todos) ? session.todos : []);
    loadQueueFromSession(Array.isArray(session.queuedMessages) ? session.queuedMessages : [], session.id);

    this.workflowManager = this.createWorkflowManager();
    if (session.workflowState) {
      this.workflowManager.deserialize(session.workflowState);
    }

    this.activeSession.completionMessages = this.completionMessages;
    await this.persistActiveSession();
    this.emitSessionEvent(session.id, 'session_activated', this.getActiveSessionSnapshot());
    this.emitWorkflowUpdated();
  }

  private createWorkflowManager(): WorkflowManager {
    const workflowManager = new WorkflowManager();
    workflowManager.registerToolRegistry(this.deps.toolRegistry);
    workflowManager.setCronScheduleHandler(async ({ schedule, prompt }) => {
      const current = workflowManager.getCurrentWorkflow() as CronWorkflow;
      current.setSchedule(schedule, prompt);
      await this.persistActiveSession();
      this.emitWorkflowUpdated();
      return `Cron schedule set: ${schedule}. Prompt: "${prompt}"`;
    });
    return workflowManager;
  }

  private startRunSequence(sessionId: string, initialMessage: string): void {
    if (this.activeRunPromise) {
      throw new Error('A session is already running.');
    }

    const runPromise = this.runSequence(sessionId, initialMessage)
      .catch((error) => {
        logger.error('API run sequence failed', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
        this.emitSessionEvent(sessionId, 'error', {
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (this.activeRunPromise === runPromise) {
          this.activeRunPromise = null;
          this.abortController = null;
          this.abortRequested = false;
        }
      });

    this.activeRunPromise = runPromise;
  }

  private async runSequence(sessionId: string, initialMessage: string): Promise<void> {
    let nextMessage: string | null = initialMessage;
    while (nextMessage && !this.abortRequested) {
      await this.runSingleTurn(sessionId, nextMessage);
      if (this.abortRequested || this.activeSession?.id !== sessionId) {
        break;
      }
      nextMessage = getNextQueued(sessionId)?.content ?? null;
    }
  }

  private async runSingleTurn(sessionId: string, userContent: string): Promise<void> {
    if (!this.client || !this.config || !this.workflowManager || this.activeSession?.id !== sessionId) {
      throw new Error('Session is not active.');
    }

    const parsedContent = await this.deps.parseInputWithImages(userContent);
    if (!this.workflowManager.isActive()) {
      this.workflowManager.start();
    }

    const workflowResult = this.workflowManager.processMessage(parsedContent, this.completionMessages);
    this.completionMessages = workflowResult.messages;

    const startingInterjects = this.pendingInterjects.splice(0);
    if (startingInterjects.length > 0) {
      const extra = startingInterjects.map((message) => ({
        role: 'user' as const,
        content: `[interject] ${message.content}`,
      }));
      this.completionMessages = [...this.completionMessages, ...extra];
    }

    if (this.activeSession.title === 'New session') {
      this.activeSession.title = this.deps.generateTitle(this.completionMessages);
    }

    await this.persistActiveSession();
    this.emitSessionEvent(sessionId, 'session_updated', this.getActiveSessionSnapshot());

    const pricing = this.deps.getModelPricing(this.config.provider, this.config.model);
    const requestDefaults = this.deps.getRequestDefaultParams(this.config.provider, this.config.model);
    let shouldContinueWorkflow = true;

    while (shouldContinueWorkflow && this.workflowManager.isActive()) {
      if (this.abortRequested) {
        break;
      }

      this.abortController = new AbortController();
      const updated = await this.deps.runAgenticLoop(
        this.client,
        this.config.model,
        [...this.completionMessages],
        userContent,
        (event) => this.handleAgentEvent(sessionId, event),
        {
          pricing: pricing || undefined,
          abortSignal: this.abortController.signal,
          sessionId,
          requestDefaults,
          approvalManager: this.approvalManager,
          systemPromptAddition: this.combineSystemPromptAdditions(workflowResult.systemPromptAddition),
          getInterjects: () => {
            const interjects = this.pendingInterjects.splice(0).map(
              (message): Message => ({ role: 'user', content: `[interject] ${message.content}` }),
            );
            return interjects;
          },
        },
      );

      this.completionMessages = updated;
      await this.persistActiveSession();
      this.emitSessionEvent(sessionId, 'session_updated', this.getActiveSessionSnapshot());

      const lastMessage = this.completionMessages[this.completionMessages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant') {
        shouldContinueWorkflow = this.workflowManager.onResponse(lastMessage);
      } else {
        shouldContinueWorkflow = false;
      }

      if (shouldContinueWorkflow && this.workflowManager.getCurrentType() === 'loop') {
        const loopWorkflow = this.workflowManager.getCurrentWorkflow() as LoopWorkflow;
        const nextWorkflowMessage = loopWorkflow.getNextMessage();
        if (nextWorkflowMessage) {
          this.completionMessages = [...this.completionMessages, nextWorkflowMessage];
          await this.persistActiveSession();
          this.emitSessionEvent(sessionId, 'session_updated', this.getActiveSessionSnapshot());
        }
      }
    }
  }

  private handleAgentEvent(sessionId: string, event: AgentEvent): void {
    if (event.type === 'usage' && event.usage) {
      this.totalCost += event.usage.cost;
    }

    if (event.type === 'sub_agent_iteration' && event.subAgentUsage) {
      this.totalCost += event.subAgentUsage.estimatedCost;
    }

    this.emitSessionEvent(sessionId, event.type, event);
  }

  private async buildCurrentSystemPrompt(): Promise<string> {
    const basePrompt = await this.deps.generateSystemPrompt();
    const additions = this.combineSystemPromptAdditions();
    return additions ? `${basePrompt}\n\n---\n${additions}` : basePrompt;
  }

  private combineSystemPromptAdditions(extra?: string): string | undefined {
    const additions = Array.from(this.activeSkills.values());
    if (extra?.trim()) additions.push(extra.trim());
    return additions.length > 0 ? additions.join('\n\n') : undefined;
  }

  private async refreshActiveSessionSystemPrompt(): Promise<void> {
    if (!this.activeSession) return;
    this.completionMessages = ensureSystemPromptAtTop(
      this.completionMessages,
      await this.buildCurrentSystemPrompt(),
    );
    this.activeSession.completionMessages = this.completionMessages;
  }

  private async persistActiveSession(): Promise<void> {
    if (!this.activeSession || !this.workflowManager) return;

    this.activeSession.completionMessages = this.completionMessages;
    this.activeSession.todos = getTodosForSession(this.activeSession.id);
    this.activeSession.queuedMessages = getQueueForSession(this.activeSession.id);
    this.activeSession.interjectMessages = [...this.pendingInterjects];
    this.activeSession.workflowState = this.workflowManager.getState();
    this.activeSession.totalCost = this.totalCost;
    await this.deps.saveSession(this.activeSession);
  }

  private getActiveSessionSnapshot(): SessionSnapshot {
    const session = this.requireActiveSession();
    return {
      ...session,
      completionMessages: this.completionMessages,
      todos: getTodosForSession(session.id),
      queuedMessages: getQueueForSession(session.id),
      interjectMessages: [...this.pendingInterjects],
      workflowState: this.workflowManager?.getState(),
      totalCost: this.totalCost,
      active: true,
      running: this.isRunning(),
    };
  }

  private emitWorkflowUpdated(): void {
    if (!this.activeSession) return;
    this.emitSessionEvent(this.activeSession.id, 'workflow_updated', this.getWorkflow());
  }

  private emitSessionEvent<T>(sessionId: string, type: string, data: T): void {
    const event: ApiEvent<T> = {
      type,
      sessionId,
      timestamp: new Date().toISOString(),
      data,
    };
    this.events.emit(this.getEventChannel(sessionId), event);
  }

  private getEventChannel(sessionId: string): string {
    return `session:${sessionId}`;
  }

  private createApprovalId(base?: string): string {
    const seed = base || `approval-${Date.now()}`;
    return `${seed}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private resolveAllPendingApprovals(decision: ApprovalResponse): void {
    for (const [id, pending] of this.pendingApprovals) {
      this.pendingApprovals.delete(id);
      pending.resolve(decision);
      if (pending.approval.sessionId) {
        this.emitSessionEvent(pending.approval.sessionId, 'approval_resolved', {
          id,
          decision,
        });
      }
    }
  }

  private async loadExistingSession(sessionId: string): Promise<Session> {
    const session = await this.deps.loadSession(sessionId);
    if (!session) {
      throw new ApiError(404, `Session "${sessionId}" not found.`);
    }
    return session;
  }

  private isRunning(): boolean {
    return this.activeRunPromise !== null;
  }

  private requireConfig(): Config {
    if (!this.config) {
      throw new ApiError(503, 'Runtime is not initialized.');
    }
    return this.config;
  }

  private requireActiveSession(): Session {
    if (!this.activeSession) {
      throw new ApiError(400, 'No active session. Activate or create a session first.');
    }
    return this.activeSession;
  }

  private requireActiveWorkflowManager(): WorkflowManager {
    this.requireActiveSession();
    if (!this.workflowManager) {
      throw new ApiError(503, 'Workflow manager is not initialized.');
    }
    return this.workflowManager;
  }
}
