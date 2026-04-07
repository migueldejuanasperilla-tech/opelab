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
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  const { topic, sectionTitle, sectionText } = req.body;
  if (!topic || !sectionText) return res.status(400).json({ error: 'topic and sectionText required' });

  const callClaude = async (prompt, maxTokens=4096) => {
    console.log(`[gen-learning] Calling Claude (max_tokens=${maxTokens}, prompt=${prompt.length}ch)`);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:maxTokens,messages:[{role:'user',content:prompt}]}),
    });
    const d=await r.json();
    if(!r.ok) throw new Error(d?.error?.message||`HTTP ${r.status}`);
    const text=(d.content||[]).map(c=>c.text||'').join('').trim();
    if(d.stop_reason==='max_tokens') console.warn('[gen-learning] TRUNCATED by max_tokens!');
    console.log(`[gen-learning] OK: ${text.length}ch, stop=${d.stop_reason}`);
    return text.replace(/```json|```/g,'').trim();
  };

  const SYS='Eres un experto en bioquímica clínica (FEA Lab. Clínico, SESCAM 2025). IDIOMA: Todo en español. Responde SOLO con JSON válido.';
  const TRANSFER='IMPORTANTE: NUNCA preguntes directamente lo que dice el texto. SIEMPRE presenta conceptos en contexto clínico/analítico NUEVO donde el estudiante APLIQUE el conocimiento.';
  const CTX=`TEMA: "${topic}"\nSECCIÓN: "${sectionTitle||''}"\n\nTEXTO:\n${sectionText.slice(0,25000)}`;

  try {
    // 1. Concepts
    console.log('[gen-learning] Phase 1: concepts');
    const raw=await callClaude(`${SYS}\n\nExtrae información clave.\n\n${CTX}\n\nJSON:\n{"concepts":[{"t":"título","d":"descripción breve","cat":"concept|value|mechanism|clinical"}]}`);
    const cl=(JSON.parse(repairJSON(raw))).concepts||JSON.parse(repairJSON(raw));
    const cMap=JSON.stringify(Array.isArray(cl)?cl.slice(0,80):[]);

    // 2. Pre-test (20 transfer questions)
    console.log('[gen-learning] Phase 2: pre-test');
    const p1=await callClaude(`${SYS}\n\n${TRANSFER}\n\nGenera 20 preguntas test (PRE-TEST) de "${sectionTitle}". CONCEPTOS:\n${cMap}\n\n7 fáciles, 7 medias, 6 difíciles.\n\nJSON:\n{"questions":[{"id":"pre1","question":"...","options":["A)...","B)...","C)...","D)..."],"correct":0,"explanation":"breve","tipo":"concepto","dificultad":"media"}]}`,8192);
    const preTest=JSON.parse(repairJSON(p1));

    // 3. Guided reading
    console.log('[gen-learning] Phase 3: reading');
    const p2=await callClaude(`${SYS}\n\nLectura guiada de "${sectionTitle}" (3-6 subsecciones).\n\nCONCEPTOS:\n${cMap}\n\nJSON:\n{"sections":[{"title":"...","summary":"...","keyPoints":["..."],"checkQuestion":{"question":"...","answer":"..."}}]}`,8192);
    const guided=JSON.parse(repairJSON(p2));

    // 4. Flashcards (25)
    console.log('[gen-learning] Phase 4: flashcards');
    const p3=await callClaude(`${SYS}\n\nGenera 25 flashcards de "${sectionTitle}". CONCEPTOS:\n${cMap}\n\nJSON:\n{"flashcards":[{"id":"fc1","front":"Pregunta de aplicación","back":"Respuesta con dato","tipo":"concepto"}]}\n\n25 exactas.`,6144);
    const fc=JSON.parse(repairJSON(p3));

    // 5. Lab cases (5)
    console.log('[gen-learning] Phase 5: lab cases');
    const p4=await callClaude(`${SYS}\n\nCrea 5 casos de laboratorio de "${sectionTitle}". CONCEPTOS:\n${cMap}\n\nFormato: "Recibes en el laboratorio una muestra con: [valores con unidades]. ¿Qué patrón sugiere, interferencias a descartar, pruebas adicionales?"\nValores del contenido extraído. Razonamiento: recepción → análisis → interpretación → informe.\n\nJSON:\n{"clinicalCases":[{"id":"cc1","presentation":"Recibes...","question":"...","options":["A)...","B)...","C)...","D)..."],"correct":0,"discussion":"proceso analítico completo"}]}`,8192);
    const cc=JSON.parse(repairJSON(p4));

    // 6. Fill blanks (5)
    console.log('[gen-learning] Phase 6: fill-blanks');
    const p6=await callClaude(`${SYS}\n\nGenera 5 preguntas de completar blancos sobre "${sectionTitle}". CONCEPTOS:\n${cMap}\n\nFrase con concepto clave omitido (___). Incluir respuestas aceptables.\n\nJSON:\n{"fillBlanks":[{"id":"fb1","sentence":"La PTH actúa aumentando la reabsorción de ___","answers":["calcio"],"explanation":"breve"}]}`,4096);
    const fb=JSON.parse(repairJSON(p6));

    // 7. Diff diagnosis (2 pairs)
    console.log('[gen-learning] Phase 7: diff-diagnosis');
    const p7=await callClaude(`${SYS}\n\nGenera 2 pares de diagnóstico diferencial de "${sectionTitle}". CONCEPTOS:\n${cMap}\n\nDos casos con resultados similares pero diferencia clave.\n\nJSON:\n{"diffDiagnosis":[{"id":"dd1","caseA":"Caso A: valores...","caseB":"Caso B: valores similares con diferencia...","question":"¿Diagnóstico diferencial?","explanation":"Caso A = X porque... Caso B = Y porque..."}]}`,4096);
    const dd=JSON.parse(repairJSON(p7));

    // 8. Post-test (25 transfer questions) — 2 batches
    console.log('[gen-learning] Phase 8: post-test batch 1');
    const postBase=`${SYS}\n\n${TRANSFER}\n\nPreguntas DIFÍCILES (POST-TEST) de "${sectionTitle}". CONCEPTOS:\n${cMap}\n\nJSON:\n{"questions":[{"id":"post1","question":"...","options":["A)...","B)...","C)...","D)..."],"correct":0,"explanation":"breve","tipo":"aplicacion","dificultad":"alta"}]}`;
    const pa=await callClaude(postBase+'\n\n13 preguntas exactas.',8192);
    const b1=JSON.parse(repairJSON(pa));const q1=b1.questions||b1;
    console.log('[gen-learning] Phase 8: post-test batch 2');
    const pb=await callClaude(postBase+'\n\n12 preguntas exactas diferentes.',8192);
    const b2=JSON.parse(repairJSON(pb));const q2=b2.questions||b2;
    const postTest=[...(Array.isArray(q1)?q1:[]),...(Array.isArray(q2)?q2:[])];

    console.log('[gen-learning] ALL DONE');
    res.status(200).json({
      conceptMap:Array.isArray(cl)?cl:[],
      preTest:preTest.questions||preTest,
      guidedReading:guided.sections||guided,
      flashcards:fc.flashcards||fc,
      clinicalCases:cc.clinicalCases||cc,
      fillBlanks:fb.fillBlanks||fb,
      diffDiagnosis:dd.diffDiagnosis||dd,
      postTest,
    });
  } catch(err) {
    console.error('[gen-learning] ERROR:',err.message);
    res.status(500).json({error:err.message});
  }
}
