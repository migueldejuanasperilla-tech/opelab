export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { topic, sections } = req.body;
  if (!topic || !sections?.length) return res.status(400).json({ error: 'topic and sections required' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 8192,
        messages: [{ role: 'user', content: `Eres un experto en bioquímica clínica preparando apuntes de estudio para la oposición FEA Laboratorio Clínico (SESCAM 2025). IDIOMA: Todo en español.

TEMA: "${topic}"

A partir de los conceptos extraídos de cada sección, genera unos apuntes estructurados completos. Responde SOLO con JSON válido.

SECCIONES Y CONCEPTOS:
${JSON.stringify(sections.slice(0, 20))}

JSON:
{"notes":[{"section":"Título de la sección","content":"Texto estructurado con todos los conceptos clave, valores numéricos con unidades, mecanismos paso a paso, relaciones causales y perlas clínicas. Formato: párrafos claros con datos concretos. Incluye TODOS los valores, clasificaciones y criterios diagnósticos extraídos."}]}

Requisitos:
- Una entrada por cada sección proporcionada, en el mismo orden
- Incluir TODOS los conceptos, valores y mecanismos de cada sección
- Valores numéricos siempre con unidades
- Mecanismos descritos paso a paso
- Perlas clínicas al final de cada sección
- Lenguaje técnico de especialista FEA
- Mínimo 200 palabras por sección` }],
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
    const text = (data.content || []).map(c => c.text || '').join('').trim().replace(/```json|```/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(text); } catch {
      let s = text.replace(/,\s*$/, '');
      if (!s.endsWith(']}')) s += ']}';
      parsed = JSON.parse(s);
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
