/**
 * TabApp — Wrapper that manages a single tab/session instance.
 *
 * This class wraps the existing createApp() function with injectable managers.
 * Each tab gets its own TabApp instance with isolated:
 *  - ToolRegistry (per-tab tool management, especially for MCP tools)
 *  - McpManager (per-tab MCP connections)
 *  - ApprovalManager (per-tab approval handling)
 *
 * The TabApp coordinates initialization and cleanup of a single session.
 */

import { type CliRenderer, BoxRenderable } from '@opentui/core'
import type { Config } from '../config-core.js'
import type { Session } from '../sessions.js'
import { ToolRegistry } from '../tools/registry.js'
import { McpManager } from '../mcp/manager.js'
import { ApprovalManager } from '../utils/approval-manager.js'
import { createApp, type AppOptions } from './App.js'

export interface TabAppConfig {
  renderer: CliRenderer
  options: AppOptions
  container?: BoxRenderable
}

/**
 * TabApp — represents a single tab/session in the application.
 *
 * Usage:
 *   const tabApp = new TabApp({ renderer, options })
 *   await tabApp.initialize()
 *   // ... tab is now running
 *   await tabApp.close()
 */
export class TabApp {
  private renderer: CliRenderer
  private options: AppOptions
  private container?: BoxRenderable
  private toolRegistry: ToolRegistry
  private mcpManager: McpManager
  private approvalManager: ApprovalManager
  private isActive: boolean = false
  private rootBox?: BoxRenderable
  private title: string = 'New Chat'
  private messageCount: number = 0

  constructor({ renderer, options, container }: TabAppConfig) {
    this.renderer = renderer
    this.options = options
    this.container = container

    // Create per-tab managers for isolation
    this.toolRegistry = new ToolRegistry()
    this.mcpManager = new McpManager(this.toolRegistry)
    this.approvalManager = new ApprovalManager()
  }

  /**
   * Get the current tab title
   */
  getTitle(): string {
    return this.title
  }

  /**
   * Update the tab title based on conversation
   */
  setTitle(title: string): void {
    this.title = title
  }

  /**
   * Increment message count and check if we should update title (every 100 messages)
   */
  incrementMessageCount(): void {
    this.messageCount++
  }

  /**
   * Check if we should update title (every 100 messages)
   */
  shouldUpdateTitle(): boolean {
    return this.messageCount % 100 === 0 && this.messageCount > 0
  }

  /**
   * Set whether this tab is active (for input handling)
   */
  setActive(active: boolean): void {
    this.isActive = active
  }

  /**
   * Check if this tab is active
   */
  getIsActive(): boolean {
    return this.isActive
  }

  /**
   * Initialize the tab by running the app
   */
  async initialize(): Promise<void> {
    await createApp(this.renderer, {
      ...this.options,
      toolRegistry: this.toolRegistry,
      mcpManager: this.mcpManager,
      approvalManager: this.approvalManager,
      container: this.container,
      isActiveTab: () => this.isActive,
      onTitleUpdate: (title: string) => this.setTitle(title),
    })
  }

  /**
   * Close the tab and cleanup resources
   */
  async close(): Promise<void> {
    await this.mcpManager.close()
  }

  /**
   * Get the tool registry for this tab
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry
  }

  /**
   * Get the MCP manager for this tab
   */
  getMcpManager(): McpManager {
    return this.mcpManager
  }

  /**
   * Get the approval manager for this tab
   */
  getApprovalManager(): ApprovalManager {
    return this.approvalManager
  }
}
