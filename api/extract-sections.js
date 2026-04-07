export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });

  const { topic, pdfBase64 } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic is required' });

  try {
    const content = [];
    if (pdfBase64) {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } });
    }
    content.push({ type: 'text', text: `IDIOMA: Independientemente del idioma del documento, TODA tu respuesta debe estar en español. Si los títulos del documento están en inglés u otro idioma, tradúcelos al español.

Analiza este documento del tema "${topic}" de bioquímica clínica (FEA Laboratorio Clínico, SESCAM 2025).

Identifica TODOS los subapartados o secciones principales del capítulo leyendo el índice, tabla de contenidos, o la estructura de encabezados del documento.

Devuelve SOLO un JSON válido con esta estructura:
{"sections":[{"title":"Título de la sección traducido al español","pageHint":"página aproximada o rango"}]}

Requisitos:
- Extrae los subapartados reales del capítulo (no inventes)
- Incluye TODAS las secciones principales (típicamente 5-12 por capítulo)
- Traduce los títulos al español si el documento está en inglés
- Si no hay índice claro, identifica las secciones por los encabezados del texto
- Ordena las secciones en el orden en que aparecen en el documento` });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4096,
        messages: [{ role: 'user', content }],
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);

    const text = (data.content || []).map(c => c.text || '').join('').trim();
    const cleaned = text.replace(/```json|```/g, '').trim();

    // Try to parse, with basic repair
    let parsed;
    try { parsed = JSON.parse(cleaned); } catch {
      // Simple repair: close brackets
      let s = cleaned;
      if (!s.endsWith(']}}')) { s = s.replace(/,?\s*$/, '') + ']}'; }
      parsed = JSON.parse(s);
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
