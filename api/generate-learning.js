// ── JSON repair ─────────────────────────────────────────────────────────────
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

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });

  const { topic, sectionTitle, sectionText } = req.body;
  if (!topic || !sectionText) return res.status(400).json({ error: 'topic and sectionText are required' });

  const callClaude = async (prompt, maxTokens=4096) => {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
    const text = (data.content || []).map(c => c.text || '').join('').trim();
    return text.replace(/```json|```/g, '').trim();
  };

  const SYS = 'Eres un experto en bioquímica clínica y preparación de oposiciones FEA Laboratorio Clínico (SESCAM 2025). Responde SOLO con JSON válido parseable con JSON.parse(), sin texto adicional, sin bloques markdown.';
  const CTX = `TEMA: "${topic}"\nSECCIÓN: "${sectionTitle || 'Sin título'}"\n\nTEXTO DE LA SECCIÓN:\n${sectionText.slice(0, 30000)}`;

  try {
    // 1. Extract concept map
    const rawConcepts = await callClaude(`${SYS}\n\nExtrae TODA la información clave de esta sección. Devuelve una lista compacta en JSON.\n\n${CTX}\n\nJSON:\n{"concepts":[{"t":"título del concepto (5-8 palabras)","d":"Descripción concisa con dato específico. Máximo 2 frases.","cat":"concept|value|mechanism|clinical"}]}\n\nCategorías: concept (definiciones, clasificaciones), value (valores numéricos, rangos), mechanism (fisiopatología, mecanismos), clinical (diagnóstico, terapéutica).\n\nSé exhaustivo — extrae cada dato, valor, mecanismo y nota clínica.`);
    const concepts = JSON.parse(repairJSON(rawConcepts));
    const conceptList = concepts.concepts || concepts;
    const conceptMap = JSON.stringify(Array.isArray(conceptList) ? conceptList.slice(0, 150) : []);

    // 2. Pre-test (18 questions)
    const p1 = await callClaude(`${SYS}\n\nGenera 18 preguntas tipo test (PRE-TEST) basándote en estos conceptos de la sección "${sectionTitle}" del tema "${topic}".\n\nCONCEPTOS:\n${conceptMap}\n\nMezcla 6 fáciles, 6 medias, 6 difíciles. 4 opciones (A-D) por pregunta.\n\nJSON:\n{"questions":[{"id":"pre1","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0,"explanation":"..."}]}`, 8192);
    const preTest = JSON.parse(repairJSON(p1));

    // 3. Guided reading
    const p2 = await callClaude(`${SYS}\n\nOrganiza estos conceptos de la sección "${sectionTitle}" en subsecciones de lectura guiada.\n\nCONCEPTOS:\n${conceptMap}\n\nPara cada subsección: título, resumen (3-5 frases), puntos clave con datos concretos, pregunta de comprensión.\n\nJSON:\n{"sections":[{"title":"...","summary":"...","keyPoints":["..."],"checkQuestion":{"question":"...","answer":"..."}}]}\n\n3-6 subsecciones.`, 8192);
    const guidedReading = JSON.parse(repairJSON(p2));

    // 4. Flashcards (15)
    const p3 = await callClaude(`${SYS}\n\nGenera 15 flashcards de los conceptos más importantes de la sección "${sectionTitle}" del tema "${topic}".\n\nCONCEPTOS:\n${conceptMap}\n\nJSON:\n{"flashcards":[{"id":"fc1","front":"Pregunta concreta","back":"Respuesta precisa"}]}\n\n15 flashcards exactas. Prioriza valores numéricos, criterios diagnósticos, clasificaciones.`, 4096);
    const flashcards = JSON.parse(repairJSON(p3));

    // 5. Clinical cases (3)
    const p4 = await callClaude(`${SYS}\n\nCrea 3 casos clínicos realistas para la sección "${sectionTitle}" del tema "${topic}".\n\nCONCEPTOS:\n${conceptMap}\n\nJSON:\n{"clinicalCases":[{"id":"cc1","presentation":"Paciente...","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0,"discussion":"..."}]}`, 6144);
    const clinicalCases = JSON.parse(repairJSON(p4));

    // 6. Post-test (10)
    const p5 = await callClaude(`${SYS}\n\nGenera 10 preguntas DIFÍCILES (POST-TEST) para la sección "${sectionTitle}" del tema "${topic}". Aplicación clínica, diagnóstico diferencial, integración.\n\nCONCEPTOS:\n${conceptMap}\n\nJSON:\n{"questions":[{"id":"post1","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0,"explanation":"..."}]}`, 8192);
    const postTest = JSON.parse(repairJSON(p5));

    res.status(200).json({
      conceptMap: Array.isArray(conceptList) ? conceptList : [],
      preTest: preTest.questions || preTest,
      guidedReading: guidedReading.sections || guidedReading,
      flashcards: flashcards.flashcards || flashcards,
      clinicalCases: clinicalCases.clinicalCases || clinicalCases,
      postTest: postTest.questions || postTest,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
