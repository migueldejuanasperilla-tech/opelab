// Minimal API route — only refines section titles detected locally by pdf.js
// All PDF text extraction happens client-side. This route makes 1 Claude call.

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { action, topic, sections } = req.body;

  if (action === 'refine_titles') {
    if (!sections?.length) return res.status(400).json({ error: 'sections required' });
    try {
      const summary = sections.map(s => `"${s.title}" (${(s.preview || '').slice(0, 120)}...)`).join('\n');
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5', max_tokens: 2048,
          messages: [{ role: 'user', content: `Responde ÚNICAMENTE con JSON puro. Sin markdown, sin backticks, sin #.\n\nEstas son secciones detectadas de un capítulo de bioquímica clínica sobre "${topic}". Refina los títulos al español, limpia nombres, corrige errores de OCR.\n\n${summary}\n\n{"titles":[${sections.map(() => '"título refinado"').join(',')}]}` }],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
      let text = (data.content || []).map(c => c.text || '').join('').trim();
      // Clean markdown artifacts
      text = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
      text = text.split('\n').filter(l => !/^\s*#/.test(l)).join('\n').trim();
      const idx = text.indexOf('{');
      if (idx > 0) text = text.slice(idx);
      res.status(200).json(JSON.parse(text));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    res.status(400).json({ error: 'Unknown action. Only refine_titles is supported.' });
  }
}
