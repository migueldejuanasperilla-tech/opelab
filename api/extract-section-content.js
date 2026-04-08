export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { sectionTitle, subsections, chapterText } = req.body;
  if (!sectionTitle || !chapterText) return res.status(400).json({ error: 'sectionTitle and chapterText required' });

  const subsStr = subsections?.length ? ` (incluye subsecciones: ${subsections.join(', ')})` : '';

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5', max_tokens: 8192,
        messages: [{ role: 'user', content: `Del siguiente texto de libro médico, extrae TODA la información relacionada con "${sectionTitle}"${subsStr}. Copia el contenido relevante de forma exhaustiva sin resumir. Incluye todos los valores numéricos, mecanismos, criterios diagnósticos y notas clínicas relacionados. Responde en español.\n\nResponde SOLO con JSON puro:\n{"content":"texto completo extraído"}\n\nTEXTO DEL CAPÍTULO:\n${chapterText}` }],
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
    let text = (data.content || []).map(c => c.text || '').join('').trim();
    text = text.replace(/```json|```/g, '').trim();
    const idx = text.indexOf('{');
    if (idx > 0) text = text.slice(idx);
    try {
      const parsed = JSON.parse(text);
      return res.status(200).json({ content: parsed.content || text });
    } catch {
      return res.status(200).json({ content: text });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
