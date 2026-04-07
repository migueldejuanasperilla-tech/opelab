function repairJSON(str){
  try{JSON.parse(str);return str;}catch{}
  let s=str.trim();
  let braces=0,brackets=0,inString=false,escape=false;
  for(let i=0;i<s.length;i++){const c=s[i];if(escape){escape=false;continue;}if(c==='\\'){escape=true;continue;}if(c==='"'){inString=!inString;continue;}if(inString)continue;if(c==='{')braces++;else if(c==='}')braces--;else if(c==='[')brackets++;else if(c===']')brackets--;}
  if(inString)s+='"';s=s.replace(/,\s*$/,'');s=s.replace(/,\s*"[^"]*$/,'');
  while(brackets>0){s+=']';brackets--;}while(braces>0){s+='}';braces--;}
  try{JSON.parse(s);return s;}catch{const lc=s.lastIndexOf(',');if(lc>-1){s=s.slice(0,lc);while(brackets>0){s+=']';brackets--;}while(braces>0){s+='}';braces--;}}return s;}
}

export const config={maxDuration:300};

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const apiKey=process.env.ANTHROPIC_API_KEY;
  if(!apiKey)return res.status(500).json({error:'ANTHROPIC_API_KEY not configured'});
  const{topic,sectionTitle,sectionText}=req.body;
  if(!topic||!sectionText)return res.status(400).json({error:'topic and sectionText required'});

  const callClaude=async(prompt,maxTokens=4096,retries=3)=>{
    for(let a=1;a<=retries;a++){
      try{
        console.log(`[gen] call (attempt ${a}, max_tokens=${maxTokens})`);
        const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:maxTokens,messages:[{role:'user',content:prompt}]})});
        const d=await r.json();
        if(!r.ok){if(a<retries&&(r.status===429||r.status>=500)){await new Promise(w=>setTimeout(w,a*5000));continue;}throw new Error(d?.error?.message||`HTTP ${r.status}`);}
        if(d.stop_reason==='max_tokens'&&a<retries&&maxTokens<12000){console.warn('[gen] truncated, retrying with more tokens');maxTokens+=4096;continue;}
        const text=(d.content||[]).map(c=>c.text||'').join('').trim();
        console.log(`[gen] ok ${text.length}ch stop=${d.stop_reason}`);
        return text.replace(/```json|```/g,'').trim();
      }catch(e){if(a>=retries)throw e;console.warn(`[gen] retry ${a}: ${e.message}`);await new Promise(w=>setTimeout(w,a*3000));}
    }
  };

  const SYS='Eres un experto en bioquímica clínica (FEA Lab. Clínico, SESCAM 2025). IDIOMA: Todo en español. Responde SOLO con JSON válido.';
  const TRANSFER='NUNCA preguntes lo literal. SIEMPRE contexto clínico NUEVO para APLICAR conocimiento.';
  const errors=[];

  const runPhase=async(name,fn)=>{
    console.log(`[gen] ${name}...`);
    try{const r=await fn();console.log(`[gen] ✓ ${name}`);return r;}
    catch(e){console.error(`[gen] ✗ ${name}: ${e.message}`);errors.push(name);return null;}
  };

  try{
    // 1. Concepts
    const concepts=await runPhase('concepts',async()=>{
      const r=await callClaude(`${SYS}\n\nExtrae información clave.\n\nTEMA:"${topic}" SECCIÓN:"${sectionTitle}"\n\n${sectionText.slice(0,25000)}\n\nJSON:\n{"concepts":[{"t":"título","d":"desc breve","cat":"concept|value|mechanism|clinical"}]}`);
      return JSON.parse(repairJSON(r));
    });
    if(!concepts)return res.status(500).json({error:'Failed to extract concepts'});
    const cl=concepts.concepts||concepts;
    const cMap=JSON.stringify(Array.isArray(cl)?cl.slice(0,60):[]);

    // 2-10: All phases with error isolation
    const preTest=await runPhase('pretest',async()=>{
      const r=await callClaude(`${SYS}\n\n${TRANSFER}\n\n20 preguntas test de "${sectionTitle}". CONCEPTOS:\n${cMap}\n\n7 fáciles,7 medias,6 difíciles.\nJSON:\n{"questions":[{"id":"p1","question":"...","options":["A)...","B)...","C)...","D)..."],"correct":0,"explanation":"breve","tipo":"concepto","dificultad":"media"}]}`,8192);
      return JSON.parse(repairJSON(r));
    });
    const guided=await runPhase('reading',async()=>{
      const r=await callClaude(`${SYS}\n\nLectura guiada de "${sectionTitle}" (3-6). CONCEPTOS:\n${cMap}\nJSON:\n{"sections":[{"title":"...","summary":"...","keyPoints":["..."],"checkQuestion":{"question":"...","answer":"..."}}]}`,8192);
      return JSON.parse(repairJSON(r));
    });
    const fc=await runPhase('flashcards',async()=>{
      const r=await callClaude(`${SYS}\n\n25 flashcards de "${sectionTitle}". CONCEPTOS:\n${cMap}\nJSON:\n{"flashcards":[{"id":"f1","front":"Q","back":"A","tipo":"concepto"}]} 25 exactas.`,6144);
      return JSON.parse(repairJSON(r));
    });
    const cc=await runPhase('cases',async()=>{
      const r1=await callClaude(`${SYS}\n\n3 casos lab de "${sectionTitle}". CONCEPTOS:\n${cMap}\nFormato:"Recibes muestra con [valores]..."\nJSON:\n{"clinicalCases":[{"id":"c1","presentation":"...","question":"...","options":["A)...","B)...","C)...","D)..."],"correct":0,"discussion":"breve"}]}`,6144);
      const b1=JSON.parse(repairJSON(r1));
      const r2=await callClaude(`${SYS}\n\n2 casos lab más de "${sectionTitle}". CONCEPTOS:\n${cMap}\nJSON:\n{"clinicalCases":[{"id":"c4","presentation":"...","question":"...","options":["A)...","B)...","C)...","D)..."],"correct":0,"discussion":"breve"}]}`,4096);
      const b2=JSON.parse(repairJSON(r2));
      return{clinicalCases:[...(b1.clinicalCases||b1||[]),...(b2.clinicalCases||b2||[])]};
    });
    const fb=await runPhase('fillblanks',async()=>{
      const r=await callClaude(`${SYS}\n\n5 completar blancos de "${sectionTitle}". CONCEPTOS:\n${cMap}\nJSON:\n{"fillBlanks":[{"id":"fb1","sentence":"___","answers":["resp"],"explanation":"breve"}]}`,4096);
      return JSON.parse(repairJSON(r));
    });
    const dd=await runPhase('diffdiag',async()=>{
      const r=await callClaude(`${SYS}\n\n2 pares diferencial de "${sectionTitle}". CONCEPTOS:\n${cMap}\nJSON:\n{"diffDiagnosis":[{"id":"d1","caseA":"...","caseB":"...","question":"...","explanation":"..."}]}`,4096);
      return JSON.parse(repairJSON(r));
    });
    const oq=await runPhase('openqs',async()=>{
      const r=await callClaude(`${SYS}\n\n3 preguntas abiertas de "${sectionTitle}". CONCEPTOS:\n${cMap}\nJSON:\n{"openQuestions":[{"id":"o1","question":"...","modelAnswer":"...","keyConcepts":["..."]}]}`,4096);
      return JSON.parse(repairJSON(r));
    });
    const rm=await runPhase('relations',async()=>{
      const r=await callClaude(`${SYS}\n\n8-12 relaciones entre conceptos de "${sectionTitle}". CONCEPTOS:\n${cMap}\nJSON:\n{"relationships":[{"from":"A","to":"B","relation":"causa|regula|inhibe"}]}`,4096);
      return JSON.parse(repairJSON(r));
    });
    const postTest=await runPhase('posttest',async()=>{
      const base=`${SYS}\n\n${TRANSFER}\n\nPreguntas DIFÍCILES de "${sectionTitle}". CONCEPTOS:\n${cMap}\nJSON:\n{"questions":[{"id":"p1","question":"...","options":["A)...","B)...","C)...","D)..."],"correct":0,"explanation":"breve","tipo":"aplicacion","dificultad":"alta"}]}`;
      const r1=await callClaude(base+'\n\n13 preguntas.',8192);const b1=JSON.parse(repairJSON(r1));
      const r2=await callClaude(base+'\n\n12 preguntas diferentes.',8192);const b2=JSON.parse(repairJSON(r2));
      return{questions:[...(b1.questions||b1||[]),...(b2.questions||b2||[])]};
    });

    console.log(`[gen] DONE. Errors: ${errors.length?errors.join(','):'none'}`);
    res.status(200).json({
      conceptMap:Array.isArray(cl)?cl:[],
      preTest:preTest?.questions||preTest||[],
      guidedReading:guided?.sections||guided||[],
      flashcards:fc?.flashcards||fc||[],
      clinicalCases:cc?.clinicalCases||cc||[],
      fillBlanks:fb?.fillBlanks||fb||[],
      diffDiagnosis:dd?.diffDiagnosis||dd||[],
      openQuestions:oq?.openQuestions||oq||[],
      conceptRelations:rm?.relationships||rm||[],
      postTest:postTest?.questions||postTest||[],
      errors:errors.length?errors:undefined,
    });
  }catch(err){console.error('[gen] FATAL:',err.message);res.status(500).json({error:err.message});}
}
