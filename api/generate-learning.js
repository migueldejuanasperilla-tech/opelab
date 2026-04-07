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

// ── Split text into ~2500-word blocks respecting paragraph boundaries ───────
function splitIntoBlocks(text, targetWords=2500){
  const paragraphs=text.split(/\n\s*\n/).filter(p=>p.trim());
  if(!paragraphs.length) return [text];
  const blocks=[];
  let current=[];
  let currentWords=0;
  for(const para of paragraphs){
    const wc=para.trim().split(/\s+/).length;
    if(currentWords+wc>targetWords&&current.length>0){
      blocks.push(current.join('\n\n'));
      current=[para];
      currentWords=wc;
    }else{
      current.push(para);
      currentWords+=wc;
    }
  }
  if(current.length>0) blocks.push(current.join('\n\n'));
  return blocks;
}

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });

  const { topic, chapterText } = req.body;
  if (!topic || !chapterText) return res.status(400).json({ error: 'topic and chapterText are required' });

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

  try {
    // ── PHASE A: Split and extract ──────────────────────────────────────────
    const blocks = splitIntoBlocks(chapterText);
    const allConcepts = [];

    for (let i = 0; i < blocks.length; i++) {
      const raw = await callClaude(`${SYS}

Extrae TODA la información clave de este bloque de texto. Devuelve una lista compacta en JSON.

TEMA: "${topic}"
BLOQUE ${i+1} de ${blocks.length}:
${blocks[i]}

JSON:
{"concepts":[{"t":"título del concepto (5-8 palabras)","d":"Descripción concisa con dato específico. Máximo 2 frases.","cat":"concept|value|mechanism|clinical"}]}

Categorías:
- concept: definiciones, clasificaciones, criterios
- value: valores numéricos, rangos de referencia, porcentajes, tiempos
- mechanism: rutas metabólicas, fisiopatología, mecanismos de acción
- clinical: notas diagnósticas, terapéuticas, correlaciones clínicas

Sé exhaustivo — extrae cada dato, valor, mecanismo y nota clínica del bloque. Incluye nombres de enzimas, genes, proteínas, criterios diagnósticos con sus valores.`);
      const parsed = JSON.parse(repairJSON(raw));
      const concepts = parsed.concepts || parsed;
      allConcepts.push(...(Array.isArray(concepts) ? concepts : []));
    }

    // ── PHASE B: Generate learning materials from full concept map ───────────
    const conceptMap = JSON.stringify(allConcepts.slice(0, 300));

    // B1: Pre-test (18 questions distributed across all content)
    const p1 = await callClaude(`${SYS}

Usando este mapa completo de conceptos extraídos del tema "${topic}", genera exactamente 18 preguntas tipo test para un PRE-TEST (evaluar conocimientos previos).

MAPA DE CONCEPTOS (${allConcepts.length} conceptos):
${conceptMap}

Requisitos:
- Las 18 preguntas deben cubrir TODO el tema de forma equilibrada
- Mezcla 6 fáciles, 6 medias, 6 difíciles
- Cada pregunta se basa en uno o más conceptos del mapa
- 4 opciones por pregunta con letras A-D

JSON:
{"questions":[{"id":"pre1","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0,"explanation":"..."}]}`, 8192);
    const preTest = JSON.parse(repairJSON(p1));

    // B2: Guided reading sections
    const p2 = await callClaude(`${SYS}

Usando este mapa de conceptos extraídos del tema "${topic}", organiza el contenido en secciones de lectura guiada. Agrupa los conceptos por área temática natural.

MAPA DE CONCEPTOS (${allConcepts.length} conceptos):
${conceptMap}

Para cada sección genera: título, resumen de 3-5 frases integrando los conceptos, puntos clave específicos, y una pregunta de comprensión.

JSON:
{"sections":[{"title":"...","summary":"...","keyPoints":["..."],"checkQuestion":{"question":"...","answer":"..."}}]}

- 5-8 secciones que cubran todo el tema
- Los puntos clave deben incluir datos concretos del mapa`, 8192);
    const guidedReading = JSON.parse(repairJSON(p2));

    // B3: Flashcards (15 most important concepts)
    const p3 = await callClaude(`${SYS}

Selecciona los 15 conceptos más importantes y preguntables del tema "${topic}" y genera flashcards.

MAPA DE CONCEPTOS (${allConcepts.length} conceptos):
${conceptMap}

Prioriza: valores numéricos, criterios diagnósticos, clasificaciones, mecanismos clave, datos de alta rentabilidad en examen.

JSON:
{"flashcards":[{"id":"fc1","front":"Pregunta concreta sobre el concepto","back":"Respuesta precisa con dato numérico o clasificación"}]}

- Exactamente 15 flashcards
- Distribución equilibrada por todo el tema
- Cada flashcard = 1 dato concreto preguntable`, 4096);
    const flashcards = JSON.parse(repairJSON(p3));

    // B4: Clinical cases (3 integrating different parts)
    const p4 = await callClaude(`${SYS}

Crea 3 casos clínicos realistas que integren conceptos de DISTINTAS secciones del tema "${topic}".

MAPA DE CONCEPTOS (${allConcepts.length} conceptos):
${conceptMap}

Cada caso debe:
- Presentar un paciente con datos analíticos concretos del mapa de conceptos
- Integrar al menos 3-4 conceptos de diferentes categorías
- Tener pregunta tipo test con 4 opciones
- Incluir discusión que conecte los conceptos

JSON:
{"clinicalCases":[{"id":"cc1","presentation":"Paciente de X años...","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0,"discussion":"..."}]}`, 6144);
    const clinicalCases = JSON.parse(repairJSON(p4));

    // B5: Post-test (10 high-difficulty integration questions)
    const p5 = await callClaude(`${SYS}

Genera 10 preguntas de dificultad ALTA para un POST-TEST del tema "${topic}". Estas preguntas evalúan comprensión profunda e integración global.

MAPA DE CONCEPTOS (${allConcepts.length} conceptos):
${conceptMap}

Requisitos:
- Preguntas que integren múltiples conceptos del mapa
- Enfoque: aplicación clínica, diagnóstico diferencial, interpretación de resultados, correlación clínico-patológica
- Nivel de complejidad mayor que el pre-test
- Distribución equilibrada por todo el tema

JSON:
{"questions":[{"id":"post1","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0,"explanation":"..."}]}`, 8192);
    const postTest = JSON.parse(repairJSON(p5));

    res.status(200).json({
      conceptMap: allConcepts,
      blocksProcessed: blocks.length,
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
