/**
 * LoopSetupDialog — Interactive setup for Loop Workflow
 *
 * Provides a multi-step form to configure:
 * 1. Work prompt (what to do each iteration)
 * 2. Closing condition prompt (how to know when done)
 * 3. Max iterations (safety limit)
 *
 * Layout:
 * ┌──────────────────────────────────────────┐
 * │  🔁 Loop Workflow Setup                   │
 * │                                          │
 * │  Step 1: Work Prompt                     │
 * │  ┌──────────────────────────────────┐   │
 * │  │ What should the agent do in     │   │
 * │  │ each iteration?                 │   │
 * │  │                                  │   │
 * │  │ > [type here]                   │   │
 * │  └──────────────────────────────────┘   │
 * │                                          │
 * │  Enter → Next  |  Esc → Cancel           │
 * └──────────────────────────────────────────┘
 */

import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  t,
  fg,
  bold,
} from '@opentui/core';
import { COLORS, DARK_COLORS, LIGHT_COLORS, getThemeMode } from './theme.js';
import { ChatInput } from './ChatInput.js';

export interface LoopSetupConfig {
  workPrompt: string;
  closingConditionPrompt: string;
  maxIterations: number;
}

export type LoopSetupResult = LoopSetupConfig | null;

interface StepConfig {
  title: string;
  prompt: string;
  placeholder: string;
  validate?: (value: string) => string | null;
  transform?: (value: string) => string | number;
}

const STEPS: StepConfig[] = [
  {
    title: 'Step 1: Work Prompt',
    prompt: 'What should the agent do in each iteration?',
    placeholder: 'e.g., "Search for TODO comments in the codebase and fix one of them"',
  },
  {
    title: 'Step 2: Closing Condition',
    prompt: 'When should the agent stop? (What condition indicates completion?)',
    placeholder: 'e.g., "All TODO comments have been resolved or no more TODOs exist"',
  },
  {
    title: 'Step 3: Max Iterations',
    prompt: 'Maximum number of iterations (safety limit):',
    placeholder: '10',
    validate: (value: string): string | null => {
      const num = parseInt(value.trim(), 10);
      if (isNaN(num) || num < 1) {
        return 'Please enter a valid number (1 or greater)';
      }
      if (num > 100) {
        return 'Maximum allowed is 100 iterations';
      }
      return null;
    },
    transform: (value: string): number => {
      const num = parseInt(value.trim(), 10);
      return isNaN(num) ? 10 : Math.min(Math.max(num, 1), 100);
    },
  },
];

export class LoopSetupDialog {
  public readonly root: BoxRenderable;
  private renderer: CliRenderer;
  private onComplete: (result: LoopSetupResult) => void;

  private currentStep: number = 0;
  private values: Partial<LoopSetupConfig> = {};
  private stepText: TextRenderable;
  private promptText: TextRenderable;
  private errorText: TextRenderable;
  private inputBox: BoxRenderable;
  private chatInput: ChatInput;
  private footerText: TextRenderable;

  constructor(renderer: CliRenderer, onComplete: (result: LoopSetupResult) => void) {
    this.renderer = renderer;
    this.onComplete = onComplete;

    const bgColor = getThemeMode() === 'dark' ? DARK_COLORS.bg : LIGHT_COLORS.bg;

    // Full-screen centering wrapper
    this.root = new BoxRenderable(renderer, {
      id: 'loop-setup-root',
      flexDirection: 'column',
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: bgColor,
    });

    // Main dialog box
    const dialogBox = new BoxRenderable(renderer, {
      id: 'loop-setup-dialog',
      flexDirection: 'column',
      border: true,
      borderColor: COLORS.primary,
      borderStyle: 'single',
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 1,
      paddingBottom: 1,
      maxWidth: 80,
      minWidth: 60,
    });
    this.root.add(dialogBox);

    // Header
    const headerText = new TextRenderable(renderer, {
      id: 'loop-setup-header',
      content: t`${fg(COLORS.primary)(bold('🔁 Loop Workflow Setup'))}`,
      marginBottom: 1,
    });
    dialogBox.add(headerText);

    // Progress indicator
    const progressText = new TextRenderable(renderer, {
      id: 'loop-setup-progress',
      content: t`${fg(COLORS.dim)(`Step 1 of ${STEPS.length}`)}`,
      marginBottom: 1,
    });
    dialogBox.add(progressText);

    // Step title
    this.stepText = new TextRenderable(renderer, {
      id: 'loop-setup-step',
      content: t``, // Set by updateStep
      marginBottom: 1,
    });
    dialogBox.add(this.stepText);

    // Prompt text
    this.promptText = new TextRenderable(renderer, {
      id: 'loop-setup-prompt',
      content: t``, // Set by updateStep
      marginBottom: 1,
    });
    dialogBox.add(this.promptText);

    // Error text (hidden by default)
    this.errorText = new TextRenderable(renderer, {
      id: 'loop-setup-error',
      content: t``, // Set when validation fails
      marginBottom: 1,
    });
    dialogBox.add(this.errorText);

    // Input box container
    this.inputBox = new BoxRenderable(renderer, {
      id: 'loop-setup-input-box',
      flexDirection: 'column',
      border: true,
      borderColor: COLORS.border,
      borderStyle: 'single',
      maxHeight: 10,
      flexShrink: 0,
    });
    dialogBox.add(this.inputBox);

    // ChatInput for multi-line text entry
    this.chatInput = new ChatInput(
      renderer,
      {
        id: 'loop-setup-input',
        placeholder: '', // Set by updateStep
        placeholderColor: COLORS.dim,
        textColor: COLORS.white,
        backgroundColor: 'transparent',
        flexGrow: 1,
      },
      () => this.handleSubmit()
    );
    this.inputBox.add(this.chatInput.textarea);

    // Spacer
    const spacer = new BoxRenderable(renderer, { id: 'loop-setup-spacer', height: 1 });
    dialogBox.add(spacer);

    // Footer with controls
    this.footerText = new TextRenderable(renderer, {
      id: 'loop-setup-footer',
      content: t`${fg(COLORS.dim)('Enter → Next  |  Esc → Cancel')}`,
    });
    dialogBox.add(this.footerText);

    // Wire up keyboard handling
    this.setupKeyboardHandling();

    // Initialize first step
    this.updateStep();

    // Focus input
    this.chatInput.focus();

    // Click anywhere to focus input
    this.root.onMouseDown = () => {
      this.chatInput.focus();
    };
  }

  private setupKeyboardHandling(): void {
    const textarea = this.chatInput.textarea;

    // Override the default submit behavior
    const originalOnKeyDown = textarea.onKeyDown;

    textarea.onKeyDown = (key: any) => {
      if (key.name === 'escape') {
        key.preventDefault?.();
        this.handleCancel();
        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        // Check if shift is held (multi-line) or not (submit)
        if (!key.shift) {
          key.preventDefault?.();
          this.handleSubmit();
          return;
        }
      }

      // Pass through to original handler for other keys
      if (originalOnKeyDown) {
        originalOnKeyDown(key);
      }
    };
  }

  private updateStep(): void {
    const step = STEPS[this.currentStep];

    this.stepText.content = t`${bold(step.title)}`;
    this.promptText.content = t`${step.prompt}`;
    this.chatInput.setPlaceholder(step.placeholder);
    this.errorText.content = t``; // Clear error

    // Update progress text directly since we have the reference
    // Find the dialog box in root children
    const rootChildren = (this.root as any).children as any[];
    const progressBox = rootChildren?.find(
      (c: any) => c instanceof BoxRenderable && c.id === 'loop-setup-dialog'
    );
    if (progressBox) {
      const boxChildren = (progressBox as any).children as any[];
      const progressText = boxChildren?.find(
        (c: any) => c instanceof TextRenderable && c.id === 'loop-setup-progress'
      );
      if (progressText) {
        progressText.content = t`${fg(COLORS.dim)(`Step ${this.currentStep + 1} of ${STEPS.length}`)}`;
      }
    }

    // Update footer for last step
    if (this.currentStep === STEPS.length - 1) {
      this.footerText.content = t`${fg(COLORS.dim)('Enter → Start Loop  |  Esc → Cancel')}`;
    } else {
      this.footerText.content = t`${fg(COLORS.dim)('Enter → Next  |  Esc → Cancel')}`;
    }

    // Clear input
    this.chatInput.textarea.clear();
    this.chatInput.focus();

    this.renderer.requestRender();
  }

  private handleSubmit(): void {
    const step = STEPS[this.currentStep];
    const value = this.chatInput.textarea.editBuffer.getText().trim();

    // Validate
    if (step.validate) {
      const error = step.validate(value);
      if (error) {
        this.errorText.content = t`${fg(COLORS.red)(error)}`;
        this.renderer.requestRender();
        return;
      }
    }

    // Require non-empty value for text fields
    if (!step.transform && !value) {
      this.errorText.content = t`${fg(COLORS.red)('This field is required')}`;
      this.renderer.requestRender();
      return;
    }

    // Store value
    const transformedValue = step.transform ? step.transform(value) : value;
    switch (this.currentStep) {
      case 0:
        this.values.workPrompt = transformedValue as string;
        break;
      case 1:
        this.values.closingConditionPrompt = transformedValue as string;
        break;
      case 2:
        this.values.maxIterations = transformedValue as number;
        break;
    }

    // Move to next step or complete
    if (this.currentStep < STEPS.length - 1) {
      this.currentStep++;
      this.updateStep();
    } else {
      this.complete();
    }
  }

  private handleCancel(): void {
    this.onComplete(null);
  }

  private complete(): void {
    const result: LoopSetupConfig = {
      workPrompt: this.values.workPrompt || '',
      closingConditionPrompt: this.values.closingConditionPrompt || '',
      maxIterations: this.values.maxIterations || 10,
    };
    this.onComplete(result);
  }

  focus(): void {
    this.chatInput.focus();
  }

  destroy(): void {
    // Clean up if needed
  }
}
