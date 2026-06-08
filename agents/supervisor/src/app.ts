import express from 'express';
import { createSupervisor, logSpecialists } from './agent.js';

const app = express();
const port = parseInt(process.env.PORT ?? '8080', 10);

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
    const supervisor = createSupervisor();
    const result = await supervisor.invoke(prompt);
    res.json({ result: result.toString() });
  } catch (err) {
    console.error('invocation failed', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.listen(port, () => {
  console.log(`listening on :${port}`);
  logSpecialists();
});
