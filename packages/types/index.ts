/**
 * Shared TypeScript types for AgentQA
 * Used by both the frontend and engine
 */

// ============================================
// Test Lifecycle
// ============================================

export type TestStatus =
  | 'CREATED'
  | 'STARTING'
  | 'RUNNING'
  | 'INVESTIGATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'STOPPED';

export interface TestMetadata {
  id: string;
  url: string;
  goal: string;
  startTime: number;
  endTime?: number;
  status: TestStatus;
  actions: AgentAction[];
  events: BrowserEvent[];
  incidents: Incident[];
  bugs: BugReport[];
  verificationStatus?: VerificationStatus;
  demoMode: boolean;
}

export interface CreateTestRequest {
  url: string;
  goal: string;
  demoMode?: boolean;
}

export interface TestResponse {
  test: TestMetadata;
  sseUrl: string;
}

// ============================================
// Browser Events
// ============================================

export type EventType =
  | 'agent_action'
  | 'click'
  | 'input'
  | 'navigation'
  | 'network_request'
  | 'network_response'
  | 'console_error'
  | 'console_warning'
  | 'page_error'
  | 'timeout'
  | 'exception';

export interface BrowserEvent {
  id: string;
  runId: string;
  timestamp: number;
  type: EventType;
  data: unknown;
}

export interface NetworkRequestEvent {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
}

export interface NetworkResponseEvent {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  fromCache: boolean;
  timing: {
    startTime: number;
    domainLookupStart: number;
    domainLookupEnd: number;
    connectStart: number;
    connectEnd: number;
    requestStart: number;
    responseStart: number;
    responseEnd: number;
  };
}

export interface ConsoleErrorEvent {
  text: string;
  location?: { url: string; lineNumber: number; columnNumber: number };
}

export interface PageErrorEvent {
  message: string;
  stack?: string;
}

export interface ClickEvent {
  selector: string;
  target: string;
  x: number;
  y: number;
}

export interface InputEvent {
  selector: string;
  target: string;
  value: string;
}

export interface NavigationEvent {
  url: string;
  title: string;
  referrer: string;
}

export interface AgentActionEvent {
  action: AgentAction;
  success: boolean;
  error?: string;
}

export interface TimeoutEvent {
  action: AgentAction;
  timeout: number;
}

export interface ExceptionEvent {
  message: string;
  stack?: string;
}

// ============================================
// Agent Actions
// ============================================

export type AgentActionType =
  | 'click'
  | 'type'
  | 'navigate'
  | 'scroll'
  | 'wait'
  | 'finish';

export interface AgentAction {
  type: AgentActionType;
  target: string;
  value?: string;
  description: string;
  timestamp: number;
}

export interface ClickAction extends AgentAction {
  type: 'click';
}

export interface TypeAction extends AgentAction {
  type: 'type';
  value: string;
}

export interface NavigateAction extends AgentAction {
  type: 'navigate';
  target: string;
}

export interface ScrollAction extends AgentAction {
  type: 'scroll';
  value: string; // 'up' | 'down' | 'top' | 'bottom' | coordinate
}

export interface WaitAction extends AgentAction {
  type: 'wait';
  value: string; // milliseconds or condition
}

export interface FinishAction extends AgentAction {
  type: 'finish';
}

// ============================================
// Compact Page State
// ============================================

export interface CompactPageState {
  url: string;
  title: string;
  buttons: InteractiveElement[];
  inputs: InteractiveElement[];
  links: InteractiveElement[];
  forms: FormElement[];
}

export interface InteractiveElement {
  selector: string;
  text: string;
  tag: string;
  type?: string;
  placeholder?: string;
  value?: string;
  visible: boolean;
  enabled: boolean;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface FormElement {
  selector: string;
  action: string;
  method: string;
  fields: InteractiveElement[];
}

// ============================================
// Incidents
// ============================================

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Incident {
  id: string;
  runId: string;
  eventIds: string[];
  firstTimestamp: number;
  lastTimestamp: number;
  severity: IncidentSeverity;
  url: string;
  relatedActions: string[];
  description: string;
  investigated: boolean;
  bugId?: string;
}

// ============================================
// Bug Reports
// ============================================

export interface BugReport {
  id: string;
  runId: string;
  incidentId: string;
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  expected: string;
  actual: string;
  rootCause: string;
  evidence: Evidence[];
  suggestedFix?: CodeFix;
  createdAt: number;
}

export interface Evidence {
  eventId: string;
  type: EventType;
  description: string;
  timestamp: number;
  replayTimestamp: number;
  data: unknown;
}

export interface BugAnalysis {
  isBug: boolean;
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  expected: string;
  actual: string;
  rootCause: string;
  evidence: string[];
}

// ============================================
// Suggested Fix
// ============================================

export interface CodeFix {
  file?: string;
  explanation: string;
  patch: string;
}

export interface FixContext {
  bug: BugReport;
  evidence: Evidence[];
  sourceCode?: SourceFile[];
}

export interface SourceFile {
  path: string;
  content: string;
}

// ============================================
// AI Provider
// ============================================

export interface AgentContext {
  goal: string;
  pageState: CompactPageState;
  recentActions: AgentAction[];
  recentEvents: BrowserEvent[];
  runId: string;
  step: number;
}

export interface InvestigationContext {
  goal: string;
  currentUrl: string;
  recentActions: AgentAction[];
  suspiciousEvent: BrowserEvent;
  relevantNetworkEvents: BrowserEvent[];
  consoleErrors: BrowserEvent[];
  exceptions: BrowserEvent[];
  visibleElements: CompactPageState;
  timestamps: { first: number; last: number };
}

export interface AIProvider {
  generateAction(context: AgentContext): Promise<AgentAction>;
  analyzeBug(context: InvestigationContext): Promise<BugAnalysis>;
  generateFix(context: FixContext): Promise<CodeFix>;
}

// ============================================
// Replay (rrweb)
// ============================================

export interface ReplayEvent {
  type: number;
  timestamp: number;
  delay?: number;
  data: unknown;
}

export interface ReplayData {
  events: ReplayEvent[];
  metadata: {
    href: string;
    width: number;
    height: number;
    userAgent: string;
  };
}

// ============================================
// Verification
// ============================================

export interface VerificationStatus {
  status: 'PENDING' | 'RUNNING' | 'VERIFIED' | 'NOT_VERIFIED' | 'ERROR';
  originalFailure: FailureSignature;
  newRunId?: string;
  newFailure?: FailureSignature;
  comparison?: VerificationComparison;
  completedAt?: number;
}

export interface FailureSignature {
  type: string;
  endpoint?: string;
  status?: number;
  message?: string;
  consoleErrors: number;
  goalCompleted: boolean;
}

export interface VerificationComparison {
  networkStatusChanged: boolean;
  consoleErrorsChanged: boolean;
  goalCompletionChanged: boolean;
  originalFailureResolved: boolean;
}

// ============================================
// SSE Events
// ============================================

export type SSEEventType =
  | 'test_started'
  | 'agent_observing'
  | 'agent_action'
  | 'navigation'
  | 'network_error'
  | 'console_error'
  | 'incident_detected'
  | 'investigation_started'
  | 'bug_found'
  | 'test_completed'
  | 'verification_started'
  | 'verification_completed'
  | 'error';

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
  timestamp: number;
}

// ============================================
// API Types
// ============================================

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  ollama: 'connected' | 'disconnected';
  browser: 'ready' | 'not_ready';
  timestamp: number;
}

export interface StopTestResponse {
  success: boolean;
  message: string;
}

export interface FixGenerationResponse {
  fix: CodeFix;
}

export interface VerificationResponse {
  verification: VerificationStatus;
}

// ============================================
// Agent Limits
// ============================================

export interface AgentLimits {
  maxActions: number;
  maxRuntime: number;
  maxConsecutiveFailures: number;
  maxAICalls: number;
}

export const DEFAULT_LIMITS: AgentLimits = {
  maxActions: 20,
  maxRuntime: 120000,
  maxConsecutiveFailures: 3,
  maxAICalls: 15,
};