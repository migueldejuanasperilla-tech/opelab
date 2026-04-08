// This API route handles individual chunk extraction calls.
// The orchestration (splitting, sequencing, checkpointing) happens client-side.
// Each call processes one chunk and returns extracted concepts.

function repairJSON(str){
  try{JSON.parse(str);return str;}catch{}
  let s=str.trim();
  let braces=0,brackets=0,inString=false,escape=false;
  for(let i=0;i<s.length;i++){const c=s[i];if(escape){escape=false;continue;}if(c==='\\'){escape=true;continue;}if(c==='"'){inString=!inString;continue;}if(inString)continue;if(c==='{')braces++;else if(c==='}')braces--;else if(c==='[')brackets++;else if(c===']')brackets--;}
  if(inString)s+='"';s=s.replace(/,\s*$/,'');s=s.replace(/,\s*"[^"]*$/,'');
  while(brackets>0){s+=']';brackets--;}while(braces>0){s+='}';braces--;}
  try{JSON.parse(s);return s;}catch{const lc=s.lastIndexOf(',');if(lc>-1)s=s.slice(0,lc);return s;}
}

export const config={maxDuration:60};

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const apiKey=process.env.ANTHROPIC_API_KEY;
  if(!apiKey)return res.status(500).json({error:'ANTHROPIC_API_KEY not configured'});

  const{action,topic,sectionTitle,chunkText,tietzData,henryData,pdfBase64}=req.body;

  const callClaude=async(content,maxTokens=2048)=>{
    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:maxTokens,
        messages:[{role:'user',content}]})});
    const d=await r.json();
    if(!r.ok)throw new Error(d?.error?.message||`HTTP ${r.status}`);
    return(d.content||[]).map(c=>c.text||'').join('').trim().replace(/```json|```/g,'').trim();
  };

  try{
    // Action: extract_structure — Phase 1
    if(action==='extract_structure'){
      const content=[];
      if(pdfBase64)content.push({type:'document',source:{type:'base64',media_type:'application/pdf',data:pdfBase64}});
      content.push({type:'text',text:`IDIOMA: Todo en español. Analiza este documento de "${topic}". Identifica TODAS las secciones/subsecciones del capítulo. Devuelve SOLO JSON:\n{"sections":[{"title":"Título en español","pageStart":"página aprox inicio","pageEnd":"página aprox fin"}]}\n\n5-15 secciones, orden del documento.`});
      const raw=await callClaude(content,4096);
      return res.status(200).json(JSON.parse(repairJSON(raw)));
    }

    // Action: extract_chunk — Phase 3
    if(action==='extract_chunk'){
      const raw=await callClaude(`Eres experto en bioquímica clínica. IDIOMA: Todo en español. Extrae TODA la información de estos párrafos SIN resumir ni omitir nada.\n\nTEMA: "${topic}" · SECCIÓN: "${sectionTitle}"\n\nTEXTO:\n${chunkText}\n\nJSON compacto:\n{"concepts":[{"t":"nombre exacto","d":"definición textual completa","cat":"concept|value|mechanism|clinical"}],"values":[{"name":"parámetro","value":"número con unidades","context":"cuándo/dónde"}],"mechanisms":[{"name":"mecanismo","steps":["paso1","paso2"]}],"clinical":[{"note":"nota clínica completa"}]}\n\nSi no estás seguro de si algo es importante: INCLÚYELO.`,2048);
      return res.status(200).json(JSON.parse(repairJSON(raw)));
    }

    // Action: fuse_section — Phase 4
    if(action==='fuse_section'){
      const raw=await callClaude(`Eres experto en bioquímica clínica. IDIOMA: Todo en español. Fusiona el contenido extraído de DOS fuentes (Tietz y Henry) para la sección "${sectionTitle}" del tema "${topic}".\n\nTIETZ:\n${JSON.stringify(tietzData).slice(0,8000)}\n\nHENRY:\n${JSON.stringify(henryData).slice(0,8000)}\n\nReglas:\n- Elimina duplicados exactos\n- Conserva variaciones complementarias de ambas fuentes\n- Señala contradicciones entre fuentes con [CONTRADICCIÓN: ...]\n- Mantiene TODOS los valores numéricos de ambos libros\n- Si un dato solo aparece en una fuente, inclúyelo igualmente\n\nJSON:\n{"fusedConcepts":[{"t":"concepto","d":"definición fusionada","source":"tietz|henry|ambos"}],"values":[{"name":"...","value":"...","source":"tietz|henry|ambos"}],"contradictions":["descripción de contradicción si existe"]}`,4096);
      return res.status(200).json(JSON.parse(repairJSON(raw)));
    }

    return res.status(400).json({error:'Unknown action: '+action});
  }catch(err){
    return res.status(500).json({error:err.message});
  }
}
