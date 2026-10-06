// ── Agent Contract Schema v1 TypeScript Types ──
// TriMC v0.2.0 contract resolver canonical types
// Source: CTO-20260709-001-agent-contract-schema.md

/** Tool risk level — maps to policy-gate evaluation tiers */
export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** Agent family classification */
export type AgentFamily = 'Role' | 'Registry';

/** Decision verdicts */
export type DecisionVerdict = 'approve' | 'freeze' | 'escalate';

// ── Six Elements ──

export interface AgentIdentity {
  display_name: string;
  family: AgentFamily;
  role: string;
  description: string;
  user_invocable: boolean;
}

export interface AgentResponsibility {
  description: string;
  priority?: 'high' | 'medium' | 'low';
}

export interface DecisionRights {
  approve: string[];
  freeze?: string[];
  escalate: string[];
  forbidden: string[];
}

export interface Collaborators {
  reports_to: string;
  peers: string[];
  supervises: string[];
}

export interface ToolSpec {
  name: string;
  scope: string[];
  risk_level: ToolRiskLevel;
  requires_approval: boolean;
  /** TriMC v0.2.0 runtime routing target (e.g. "openclaw:fs:read") */
  runtime_equivalent: string;
}

export interface IOContractEntry {
  type: string;
  description: string;
  source?: string;
}

export interface IOContract {
  inputs: IOContractEntry[];
  outputs: IOContractEntry[];
}

// ── Full Contract ──

/** Runtime baseline — v3 对象形状（spec §2.4 裁决），host/tri_mc_status/tri_mc_migration_ready 等键 */
export type RuntimeBaseline = Record<string, unknown>;

export interface AgentContract {
  agent_id: string;
  version: string;
  identity: AgentIdentity;
  responsibilities: AgentResponsibility[];
  decision_rights: DecisionRights;
  collaborators: Collaborators;
  tools: ToolSpec[];
  /**
   * IO 契约（v3 schema 为 ZodOptional/Nullable：board 等非员工席契约合法缺省）。
   * strictNullChecks 型面如实化（2026-10-06 BOD 令类推放行）：消费方（capability-router
   * matchIO `io?.outputs ?? []`）设计意图即容忍缺省，域型收紧为必填系历史漂移。
   */
  io_contract?: IOContract | null;
  /** Prose behavioral instructions not captured by structured fields */
  instructions?: string;
  /** Runtime environment baseline (e.g. TriMC) */
  runtime_baseline?: RuntimeBaseline;
}
