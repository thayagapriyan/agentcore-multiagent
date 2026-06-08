import { Agent, BedrockModel } from '@strands-agents/sdk';

// Each specialist is a full Strands Agent with a focused system prompt. The
// supervisor calls them as tools (see agent.ts), so a specialist is just an Agent
// whose `invoke` is wrapped in a tool definition — "agent-as-tool", the simplest
// multi-agent pattern. Specialists share the supervisor's model to keep the POC
// dependency-free (no Gateway/Lambda needed yet).

export interface Specialist {
  name: string;
  description: string;
  build: (model: BedrockModel) => Agent;
}

export const mathSpecialist: Specialist = {
  name: 'math_specialist',
  description:
    'Solves arithmetic and math word problems. Use for any calculation or numeric reasoning.',
  build: (model) =>
    new Agent({
      model,
      systemPrompt:
        'You are a precise math specialist. Solve the problem step by step and end with the final numeric answer on its own line.',
      tools: [],
      printer: false,
    }),
};

export const greetingSpecialist: Specialist = {
  name: 'greeting_specialist',
  description:
    'Writes warm, personalized greetings and short friendly messages. Use when the user wants to be greeted or needs a friendly note.',
  build: (model) =>
    new Agent({
      model,
      systemPrompt:
        'You are a friendly greeting specialist. Write a warm, concise greeting tailored to what the user said.',
      tools: [],
      printer: false,
    }),
};

export const ALL_SPECIALISTS: Specialist[] = [mathSpecialist, greetingSpecialist];
