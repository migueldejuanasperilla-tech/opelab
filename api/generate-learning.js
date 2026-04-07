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
    console.log(`[generate-learning] Calling Claude (max_tokens=${maxTokens}, prompt_length=${prompt.length})`);
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
    const stopReason = data.stop_reason || 'unknown';
    console.log(`[generate-learning] Response: ${text.length} chars, stop_reason=${stopReason}`);
    if (stopReason === 'max_tokens') console.warn('[generate-learning] WARNING: Response truncated by max_tokens!');
    return text.replace(/```json|```/g, '').trim();
  };

  const SYS = 'Eres un experto en bioquímica clínica (FEA Laboratorio Clínico, SESCAM 2025). IDIOMA: Todo en español. Responde SOLO con JSON válido, sin texto adicional.';
  const CTX = `TEMA: "${topic}"\nSECCIÓN: "${sectionTitle || 'Sin título'}"\n\nTEXTO:\n${sectionText.slice(0, 25000)}`;

  try {
    // 1. Extract concepts (limit to 80 for prompt efficiency)
    console.log('[generate-learning] Phase 1: Extracting concepts...');
    const rawConcepts = await callClaude(`${SYS}\n\nExtrae la información clave.\n\n${CTX}\n\nJSON:\n{"concepts":[{"t":"título (5-8 palabras)","d":"Descripción concisa, máx 2 frases.","cat":"concept|value|mechanism|clinical"}]}\n\nSé exhaustivo.`);
    const concepts = JSON.parse(repairJSON(rawConcepts));
    const conceptList = concepts.concepts || concepts;
    const conceptMap = JSON.stringify(Array.isArray(conceptList) ? conceptList.slice(0, 80) : []);
    console.log(`[generate-learning] Phase 1 OK: ${Array.isArray(conceptList) ? conceptList.length : 0} concepts`);

    // 2. Pre-test (20 questions) — compact prompt
    console.log('[generate-learning] Phase 2: Pre-test (20 questions)...');
    const p1 = await callClaude(`${SYS}\n\nGenera 20 preguntas test (PRE-TEST) de "${sectionTitle}".\n\nCONCEPTOS:\n${conceptMap}\n\n7 fáciles, 7 medias, 6 difíciles.\n\nJSON:\n{"questions":[{"id":"pre1","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0,"explanation":"breve","tipo":"concepto","dificultad":"media"}]}`, 8192);
    const preTest = JSON.parse(repairJSON(p1));
    console.log(`[generate-learning] Phase 2 OK: ${(preTest.questions || preTest).length} questions`);

    // 3. Guided reading
    console.log('[generate-learning] Phase 3: Guided reading...');
    const p2 = await callClaude(`${SYS}\n\nOrganiza conceptos de "${sectionTitle}" en lectura guiada (3-6 subsecciones).\n\nCONCEPTOS:\n${conceptMap}\n\nJSON:\n{"sections":[{"title":"...","summary":"...","keyPoints":["..."],"checkQuestion":{"question":"...","answer":"..."}}]}`, 8192);
    const guidedReading = JSON.parse(repairJSON(p2));
    console.log(`[generate-learning] Phase 3 OK: ${(guidedReading.sections || guidedReading).length} sections`);

    // 4. Flashcards (25) — compact prompt
    console.log('[generate-learning] Phase 4: Flashcards (25)...');
    const p3 = await callClaude(`${SYS}\n\nGenera 25 flashcards de "${sectionTitle}".\n\nCONCEPTOS:\n${conceptMap}\n\nJSON:\n{"flashcards":[{"id":"fc1","front":"Pregunta","back":"Respuesta","tipo":"concepto"}]}\n\n25 exactas.`, 6144);
    const flashcards = JSON.parse(repairJSON(p3));
    console.log(`[generate-learning] Phase 4 OK: ${(flashcards.flashcards || flashcards).length} flashcards`);

    // 5. Clinical cases (5)
    console.log('[generate-learning] Phase 5: Clinical cases (5)...');
    const p4 = await callClaude(`${SYS}\n\nCrea 5 casos clínicos de "${sectionTitle}".\n\nCONCEPTOS:\n${conceptMap}\n\nJSON:\n{"clinicalCases":[{"id":"cc1","presentation":"Paciente...","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0,"discussion":"breve"}]}`, 8192);
    const clinicalCases = JSON.parse(repairJSON(p4));
    console.log(`[generate-learning] Phase 5 OK: ${(clinicalCases.clinicalCases || clinicalCases).length} cases`);

    // 6. Post-test — SPLIT into 2 batches to prevent token overflow
    console.log('[generate-learning] Phase 6: Post-test batch 1 (13 questions)...');
    const postBase = `${SYS}\n\nPreguntas DIFÍCILES (POST-TEST) de "${sectionTitle}". Aplicación clínica, diagnóstico diferencial.\n\nCONCEPTOS:\n${conceptMap}\n\nJSON:\n{"questions":[{"id":"post1","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0,"explanation":"breve","tipo":"aplicacion","dificultad":"alta"}]}`;
    const p5a = await callClaude(postBase + '\n\nGenera exactamente 13 preguntas.', 8192);
    const batch1 = JSON.parse(repairJSON(p5a));
    const qs1 = batch1.questions || batch1;
    console.log(`[generate-learning] Phase 6 batch 1 OK: ${Array.isArray(qs1) ? qs1.length : 0} questions`);

    console.log('[generate-learning] Phase 6: Post-test batch 2 (12 questions)...');
    const p5b = await callClaude(postBase + '\n\nGenera exactamente 12 preguntas diferentes.', 8192);
    const batch2 = JSON.parse(repairJSON(p5b));
    const qs2 = batch2.questions || batch2;
    console.log(`[generate-learning] Phase 6 batch 2 OK: ${Array.isArray(qs2) ? qs2.length : 0} questions`);

    const postTest = [...(Array.isArray(qs1) ? qs1 : []), ...(Array.isArray(qs2) ? qs2 : [])];
    console.log(`[generate-learning] Phase 6 TOTAL: ${postTest.length} post-test questions`);

    console.log('[generate-learning] ALL PHASES COMPLETE. Sending response.');
    res.status(200).json({
      conceptMap: Array.isArray(conceptList) ? conceptList : [],
      preTest: preTest.questions || preTest,
      guidedReading: guidedReading.sections || guidedReading,
      flashcards: flashcards.flashcards || flashcards,
      clinicalCases: clinicalCases.clinicalCases || clinicalCases,
      postTest: postTest,
    });
  } catch (err) {
    console.error('[generate-learning] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
}
