// ── JSON repair (duplicated from frontend for serverless use) ────────────
function repairJSON(str){
  try{JSON.parse(str);return str;}catch{}
  let s=str.trim();
  let braces=0,brackets=0,inString=false,escape=false;
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(escape){escape=false;continue;}
    if(c==='\\'){escape=true;continue;}
    if(c==='"'){inString=!inString;continue;}
    if(inString)continue;
    if(c==='{')braces++;else if(c==='}')braces--;
    else if(c==='[')brackets++;else if(c===']')brackets--;
  }
  if(inString)s+='"';
  s=s.replace(/,\s*$/,'');s=s.replace(/,\s*"[^"]*$/,'');
  while(brackets>0){s+=']';brackets--;}
  while(braces>0){s+='}';braces--;}
  try{JSON.parse(s);return s;}catch{
    const lastComma=s.lastIndexOf(',');
    if(lastComma>-1){s=s.slice(0,lastComma);while(brackets>0){s+=']';brackets--;}while(braces>0){s+='}';braces--;}}
    return s;
  }
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });

  const { topic, chapterText } = req.body;
  if (!topic || !chapterText) return res.status(400).json({ error: 'topic and chapterText are required' });

  const callClaude = async (prompt) => {
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
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
    const text = (data.content || []).map(c => c.text || '').join('').trim();
    return text.replace(/```json|```/g, '').trim();
  };

  const ctx = `Tema: "${topic}"\n\nTEXTO DEL CAPÍTULO:\n${chapterText.slice(0, 50000)}`;
  const sys = 'Eres un experto en bioquímica clínica y preparación de oposiciones FEA Laboratorio Clínico (SESCAM 2025). Responde SOLO con JSON válido parseable con JSON.parse(), sin texto adicional, sin bloques markdown.';

  try {
    // Phase 1: Pre-test (18 questions)
    const p1 = await callClaude(`${sys}\n\n${ctx}\n\nGenera exactamente 18 preguntas tipo test de opción múltiple para un PRE-TEST (evaluar conocimientos previos antes de estudiar). Mezcla 6 fáciles, 6 medias y 6 difíciles.\n\nJSON:\n{"questions":[{"id":"pre1","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0,"explanation":"..."}]}\n\n- "correct" = índice 0-3 de la opción correcta\n- 18 preguntas exactas`);
    const preTest = JSON.parse(repairJSON(p1));

    // Phase 2: Guided reading
    const p2 = await callClaude(`${sys}\n\n${ctx}\n\nDivide el texto en secciones lógicas de lectura guiada (5-8 secciones). Para cada sección proporciona un resumen, puntos clave destacados y una pregunta de comprensión con su respuesta.\n\nJSON:\n{"sections":[{"title":"...","summary":"Resumen de 3-5 frases","keyPoints":["punto clave 1","punto clave 2"],"checkQuestion":{"question":"...","answer":"..."}}]}`);
    const guidedReading = JSON.parse(repairJSON(p2));

    // Phase 3: Flashcards + Clinical cases
    const p3 = await callClaude(`${sys}\n\n${ctx}\n\nGenera:\n1. Exactamente 15 flashcards con datos concretos e importantes (valores, mecanismos, clasificaciones)\n2. Exactamente 3 casos clínicos con presentación realista, pregunta tipo test y discusión\n\nJSON:\n{"flashcards":[{"id":"fc1","front":"Pregunta o concepto","back":"Respuesta o explicación"}],"clinicalCases":[{"id":"cc1","presentation":"Paciente de 45 años...","question":"¿Cuál es el diagnóstico más probable?","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0,"discussion":"Discusión del caso..."}]}`);
    const fcData = JSON.parse(repairJSON(p3));

    // Phase 4: Post-test (10 questions)
    const p4 = await callClaude(`${sys}\n\n${ctx}\n\nGenera exactamente 10 preguntas tipo test de dificultad ALTA para un POST-TEST (evaluar comprensión profunda tras estudiar). Enfócate en aplicación clínica, diagnóstico diferencial e interpretación de resultados.\n\nJSON:\n{"questions":[{"id":"post1","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0,"explanation":"..."}]}\n\n- 10 preguntas exactas, nivel alto`);
    const postTest = JSON.parse(repairJSON(p4));

    res.status(200).json({
      preTest: preTest.questions || preTest,
      guidedReading: guidedReading.sections || guidedReading,
      flashcards: fcData.flashcards || [],
      clinicalCases: fcData.clinicalCases || [],
      postTest: postTest.questions || postTest,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
