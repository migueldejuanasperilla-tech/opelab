export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { question, userAnswer, context } = req.body;
  if (!question || !userAnswer) return res.status(400).json({ error: 'question and userAnswer required' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5', max_tokens: 1024,
        messages: [{ role: 'user', content: `Eres un evaluador experto en bioquímica clínica (FEA Laboratorio Clínico). Evalúa esta respuesta. Responde SOLO con JSON válido.

PREGUNTA: ${question}
RESPUESTA DEL ESTUDIANTE: ${userAnswer}
${context ? `CONTEXTO: ${context}` : ''}

Evalúa en escala 0-4:
0 = Incorrecta
1 = Parcialmente correcta (algún concepto bien pero errores importantes)
2 = Correcta con lagunas (idea principal bien pero faltan datos clave)
3 = Correcta (todos los conceptos principales presentes)
4 = Correcta y completa (respuesta modelo con datos específicos)

JSON: {"score":0,"feedback":"explicación específica de la evaluación","missing":["concepto que faltó 1","concepto que faltó 2"]}` }],
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
    const text = (data.content || []).map(c => c.text || '').join('').trim().replace(/```json|```/g, '').trim();
    res.status(200).json(JSON.parse(text));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
