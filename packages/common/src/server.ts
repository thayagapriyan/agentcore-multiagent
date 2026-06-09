import express from 'express';

// The AgentCore HTTP contract, shared by every agent deployable: GET /ping and
// POST /invocations on PORT (default 8080). Deliberately framework-agnostic — it
// knows nothing about Strands. Each agent supplies an `invoke(prompt) => string`
// function; the wrapper owns the rest (body parsing, prompt validation, error
// handling, the {result} shape). Keeping the agent SDK out of this package avoids
// dragging the SDK's large peer-dependency set into every consumer.

export type Invoke = (prompt: string) => Promise<string>;

export interface AgentServerOptions {
  /** Runs one invocation for a given prompt and returns the result text. */
  invoke: Invoke;
  /** Optional boot-time log hook (e.g. list loaded specialists). */
  onListen?: () => void;
}

export function createServer(options: AgentServerOptions): express.Express {
  const app = express();

  // AgentCore forwards the invocation payload without a reliable Content-Type
  // header, so parse every request body as JSON rather than gating on the type.
  app.use(express.json({ type: () => true }));

  app.get('/ping', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/invocations', async (req, res) => {
    const prompt = req.body?.prompt;
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }

    try {
      const result = await options.invoke(prompt);
      res.json({ result });
    } catch (err) {
      console.error('invocation failed', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return app;
}

export function startServer(options: AgentServerOptions): void {
  const app = createServer(options);
  const port = parseInt(process.env.PORT ?? '8080', 10);
  app.listen(port, () => {
    console.log(`listening on :${port}`);
    options.onListen?.();
  });
}
