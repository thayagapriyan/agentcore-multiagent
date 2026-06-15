import { Agent, BedrockModel } from '@strands-agents/sdk';

// Branch agents for the conditional Graph router. Unlike the supervisor's
// specialists (which are called as *tools* by a model that decides), these are
// Graph *nodes*: the graph's edges decide which branch runs, based on the intake
// node's classification. Each branch is a focused Strands Agent sharing the
// router's model — same dependency-free, in-process POC shape as the supervisor.

// A branch's `id` is what becomes the Graph node id (AgentNode derives its id from
// agent.id), and it's also the classification label the intake node emits and the
// edge handlers match on. Keeping label === node id is the whole routing contract,
// so it lives in one place.
export interface Branch {
  /** Classification label AND graph node id — must be unique. */
  id: string;
  /** One-line summary, used in the intake prompt, the agent card skill, and logs. */
  description: string;
  build: (model: BedrockModel) => Agent;
}

export const billingBranch: Branch = {
  id: 'billing',
  description:
    'Billing, payments, refunds, invoices, subscriptions, and pricing questions.',
  build: (model) =>
    new Agent({
      id: 'billing',
      name: 'billing_branch',
      model,
      systemPrompt:
        'You are a billing support specialist. Answer the customer’s billing, ' +
        'payment, refund, or subscription question clearly and concisely. State ' +
        'any next step the customer should take.',
      tools: [],
      printer: false,
    }),
};

export const techBranch: Branch = {
  id: 'tech',
  description:
    'Technical issues: bugs, errors, crashes, setup, configuration, and how-to questions.',
  build: (model) =>
    new Agent({
      id: 'tech',
      name: 'tech_branch',
      model,
      systemPrompt:
        'You are a technical support specialist. Diagnose the user’s technical ' +
        'problem and give concrete, step-by-step troubleshooting guidance.',
      tools: [],
      printer: false,
    }),
};

// The fallback branch — taken when intake can't confidently classify into a
// dedicated branch. Keeps the graph total: every request lands on exactly one
// branch, so there's no "stuck with no outgoing edge" state.
export const generalBranch: Branch = {
  id: 'general',
  description:
    'Anything that is not specifically billing or technical — general questions and catch-all.',
  build: (model) =>
    new Agent({
      id: 'general',
      name: 'general_branch',
      model,
      systemPrompt:
        'You are a helpful general support agent. Answer the user’s question ' +
        'directly and concisely.',
      tools: [],
      printer: false,
    }),
};

// Order matters only for prompt/card readability; routing is by label match.
export const ALL_BRANCHES: Branch[] = [billingBranch, techBranch, generalBranch];

// The label intake emits for the catch-all. Edge handlers route to `general`
// either on an explicit "general" classification or on anything unrecognized, so
// this is also the default when a match isn't found.
export const FALLBACK_BRANCH_ID = generalBranch.id;
