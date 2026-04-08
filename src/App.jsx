import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.mjs',import.meta.url).toString();

// ── SM-2 ────────────────────────────────────────────────────────────────────
function sm2Update(sr, q) {
  let { interval=1, reps=0, ef=2.5 } = sr||{};
  if(q>=3){if(reps===0)interval=1;else if(reps===1)interval=6;else interval=Math.round(interval*ef);reps++;}
  else{reps=0;interval=1;}
  ef=Math.max(1.3,ef+0.1-(5-q)*(0.08+(5-q)*0.02));
  return{interval,reps,ef,next:Date.now()+interval*86400000};
}
const isDue=sr=>!sr?.next||Date.now()>=sr.next;
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);

// ── Spaced review scheduling ────────────────────────────────────────────────
const REVIEW_TYPES=[
  {label:'D+1',days:1,type:'reconocimiento',duration:10,desc:'5 flashcards peor puntuación + 5 preguntas falladas'},
  {label:'D+3',days:3,type:'consolidacion',duration:15,desc:'Flashcards SM-2 + 8 preguntas + 1 caso si dominio <70%'},
  {label:'D+7',days:7,type:'integracion',duration:20,desc:'Flashcards + 10 preguntas interleaving + 1 diferencial + 1 caso'},
  {label:'D+14',days:14,type:'profundo',duration:25,desc:'Flashcards + 15 preguntas + 2 casos + mapa de relaciones'},
  {label:'D+30',days:30,type:'mantenimiento',duration:30,desc:'Sesión completa condensada — pretest + flashcards + caso + posttest'},
];
function scheduleReviews(startDate,temaId,seccionId){
  const addD=(d,n)=>{const r=new Date(d);r.setDate(r.getDate()+n);return r.toISOString().slice(0,10);};
  return REVIEW_TYPES.map(rt=>({
    id:uid(),temaId,seccionId,type:rt.type,label:rt.label,
    fechaProgramada:addD(startDate,rt.days),
    completado:false,dominioPrevio:null,duration:rt.duration,desc:rt.desc
  }));
}
function buildReviewItems(gen,reviewType,allSections){
  const items=[];
  const postQs=shuffle(gen.phases?.postTest||[]).filter(q=>q.options);
  const failedQs=postQs.filter(q=>gen.progress?.postTest?.answers&&gen.progress.postTest.answers[postQs.indexOf(q)]!==q.correct);
  const allFc=gen.phases?.flashcards||[];
  const cases=gen.phases?.clinicalCases||[];
  const diffPairs=gen.phases?.diffDiagnosis||[];

  if(reviewType==='reconocimiento'){
    // 5 worst flashcards + 5 failed posttest questions
    if(allFc.length)items.push({type:'flashcards',title:'Flashcards — peor puntuación',cards:shuffle(allFc).slice(0,5)});
    const qs=failedQs.length>=5?shuffle(failedQs).slice(0,5):shuffle(postQs).slice(0,5);
    if(qs.length)items.push({type:'quiz',title:'Preguntas falladas',questions:qs});
  }else if(reviewType==='consolidacion'){
    if(allFc.length)items.push({type:'flashcards',title:'Flashcards SM-2',cards:shuffle(allFc).slice(0,Math.min(15,allFc.length))});
    const qs=shuffle([...failedQs,...postQs]).slice(0,8);
    if(qs.length)items.push({type:'quiz',title:'8 preguntas de consolidación',questions:qs});
    if(cases.length)items.push({type:'clinical',title:'Caso clínico',cases:[cases[0]]});
  }else if(reviewType==='integracion'){
    if(allFc.length)items.push({type:'flashcards',title:'Flashcards SM-2',cards:shuffle(allFc).slice(0,Math.min(15,allFc.length))});
    // Interleaving: mix questions from multiple sections
    const mixedQs=[...shuffle(postQs).slice(0,7)];
    if(allSections){const otherQs=allSections.filter(s=>s.generated&&s!==gen).flatMap(s=>s.generated.phases?.postTest||[]).filter(q=>q.options);mixedQs.push(...shuffle(otherQs).slice(0,3));}
    if(mixedQs.length)items.push({type:'quiz',title:'10 preguntas con interleaving',questions:shuffle(mixedQs).slice(0,10)});
    if(diffPairs.length)items.push({type:'clinical',title:'Diagnóstico diferencial',cases:[{...diffPairs[0],question:diffPairs[0].question||'¿Diferencial?',options:diffPairs[0].optionsA||['A','B','C','D'],correct:diffPairs[0].correctA||0,discussion:diffPairs[0].explanation}]});
    if(cases.length)items.push({type:'clinical',title:'Caso clínico',cases:[shuffle(cases)[0]]});
  }else if(reviewType==='profundo'){
    if(allFc.length)items.push({type:'flashcards',title:'Flashcards completas',cards:shuffle(allFc)});
    if(postQs.length)items.push({type:'quiz',title:'15 preguntas de integración',questions:shuffle(postQs).slice(0,15)});
    if(cases.length>=2)items.push({type:'clinical',title:'2 casos clínicos',cases:shuffle(cases).slice(0,2)});
    else if(cases.length)items.push({type:'clinical',title:'Caso clínico',cases:[cases[0]]});
  }else if(reviewType==='mantenimiento'){
    const preQs=shuffle(gen.phases?.preTest||[]).filter(q=>q.options).slice(0,5);
    if(preQs.length)items.push({type:'quiz',title:'5 preguntas pretest',questions:preQs});
    if(allFc.length)items.push({type:'flashcards',title:'Flashcards SM-2',cards:shuffle(allFc).slice(0,Math.min(15,allFc.length))});
    if(cases.length)items.push({type:'clinical',title:'Caso clínico',cases:[shuffle(cases)[0]]});
    if(postQs.length)items.push({type:'quiz',title:'10 preguntas posttest',questions:shuffle(postQs).slice(0,10)});
  }
  return items;
}
const shuffle=arr=>{const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const fmtDate=d=>new Date(d).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'});
const fmtTime=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

// ── Storage (localStorage) ──────────────────────────────────────────────────────
function load(k,fb){try{const v=localStorage.getItem(k);return v?JSON.parse(v):fb;}catch{return fb;}}
function save(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}

// ── JSON repair — handles truncated responses from the API ────────────────────
function repairJSON(str){
  // Try parsing as-is first
  try{JSON.parse(str);return str;}catch{}
  let s=str.trim();
  // Count open brackets/braces to determine what needs closing
  let braces=0,brackets=0,inString=false,escape=false;
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(escape){escape=false;continue;}
    if(c==='\\'){escape=true;continue;}
    if(c==='"'){inString=!inString;continue;}
    if(inString)continue;
    if(c==='{')braces++;
    else if(c==='}')braces--;
    else if(c==='[')brackets++;
    else if(c===']')brackets--;
  }
  // If we're in the middle of a string, close it
  if(inString)s+='"';
  // Close any incomplete objects/arrays — order matters (most recently opened first)
  // Trim trailing incomplete key-value (comma + partial)
  s=s.replace(/,\s*$/, '');
  s=s.replace(/,\s*"[^"]*$/, ''); // trailing incomplete key
  // Close structures
  while(brackets>0){s+=']';brackets--;}
  while(braces>0){s+='}';braces--;}
  try{JSON.parse(s);return s;}catch{
    // Last resort: remove last incomplete element and close
    const lastComma=s.lastIndexOf(',');
    if(lastComma>-1){
      s=s.slice(0,lastComma);
      while(brackets>0){s+=']';brackets--;}
      while(braces>0){s+='}';braces--;}
    }
    return s;
  }
}

// ── IndexedDB — PDFs y preguntas (sin límite de tamaño) ───────────────────────
const IDB_NAME='opelab_pdfs', IDB_STORE='pdfs', IDB_QS_STORE='questions', IDB_LEARN_STORE='learning';
function idbOpen(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(IDB_NAME,3); // version 3 adds learning store
    r.onupgradeneeded=e=>{
      const db=e.target.result;
      if(!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      if(!db.objectStoreNames.contains(IDB_QS_STORE)) db.createObjectStore(IDB_QS_STORE);
      if(!db.objectStoreNames.contains(IDB_LEARN_STORE)) db.createObjectStore(IDB_LEARN_STORE);
    };
    r.onsuccess=e=>res(e.target.result);
    r.onerror=rej;
  });
}
async function idbSave(key,blob){const db=await idbOpen();return new Promise((res,rej)=>{const tx=db.transaction(IDB_STORE,'readwrite');tx.objectStore(IDB_STORE).put(blob,key);tx.oncomplete=res;tx.onerror=rej;});}
async function idbLoad(key){const db=await idbOpen();return new Promise((res,rej)=>{const tx=db.transaction(IDB_STORE,'readonly');const r=tx.objectStore(IDB_STORE).get(key);r.onsuccess=()=>res(r.result||null);r.onerror=rej;});}
async function idbDel(key){const db=await idbOpen();return new Promise((res,rej)=>{const tx=db.transaction(IDB_STORE,'readwrite');tx.objectStore(IDB_STORE).delete(key);tx.oncomplete=res;tx.onerror=rej;});}

// Questions store — cada pregunta es un registro independiente keyed by q.id
async function idbSaveQ(q){const db=await idbOpen();return new Promise((res,rej)=>{const tx=db.transaction(IDB_QS_STORE,'readwrite');tx.objectStore(IDB_QS_STORE).put(q,q.id);tx.oncomplete=res;tx.onerror=rej;});}
async function idbDelQ(id){const db=await idbOpen();return new Promise((res,rej)=>{const tx=db.transaction(IDB_QS_STORE,'readwrite');tx.objectStore(IDB_QS_STORE).delete(id);tx.oncomplete=res;tx.onerror=rej;});}
async function idbLoadAllQs(){const db=await idbOpen();return new Promise((res,rej)=>{const tx=db.transaction(IDB_QS_STORE,'readonly');const r=tx.objectStore(IDB_QS_STORE).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=rej;});}
async function idbClearQs(){const db=await idbOpen();return new Promise((res,rej)=>{const tx=db.transaction(IDB_QS_STORE,'readwrite');tx.objectStore(IDB_QS_STORE).clear();tx.oncomplete=res;tx.onerror=rej;});}
// Learning store — aprendizaje interactivo por tema
async function idbSaveLearning(topic,data){const db=await idbOpen();return new Promise((res,rej)=>{const tx=db.transaction(IDB_LEARN_STORE,'readwrite');tx.objectStore(IDB_LEARN_STORE).put(data,topic);tx.oncomplete=res;tx.onerror=rej;});}
async function idbLoadLearning(topic){const db=await idbOpen();return new Promise((res,rej)=>{const tx=db.transaction(IDB_LEARN_STORE,'readonly');const r=tx.objectStore(IDB_LEARN_STORE).get(topic);r.onsuccess=()=>res(r.result||null);r.onerror=rej;});}
async function idbLoadAllLearning(){const db=await idbOpen();return new Promise((res,rej)=>{const tx=db.transaction(IDB_LEARN_STORE,'readonly');const store=tx.objectStore(IDB_LEARN_STORE);const keys=store.getAllKeys();const vals=store.getAll();tx.oncomplete=()=>{const m={};keys.result.forEach((k,i)=>{if(vals.result[i])m[k]=vals.result[i];});res(m);};tx.onerror=rej;});}
async function idbDeleteLearning(topic){const db=await idbOpen();return new Promise((res,rej)=>{const tx=db.transaction(IDB_LEARN_STORE,'readwrite');tx.objectStore(IDB_LEARN_STORE).delete(topic);tx.oncomplete=res;tx.onerror=rej;});}
// Clave por tema (para el mapa de metadata)
const topicPdfKey=t=>{
  // Preserve §tietz / §henry suffix before sanitizing
  let suffix='';
  if(t.includes('§')){const parts=t.split('§');suffix='_'+parts.pop();t=parts.join('');}
  return 'pdf_'+t.replace(/[^a-zA-Z0-9]/g,'').slice(0,40)+suffix;
};
// Clave por archivo individual en IndexedDB
const topicFilePdfKey=(t,id)=>topicPdfKey(t)+'_'+id;
// Convertir Blob/File a base64 para la API
const blobToB64=blob=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.onerror=rej;r.readAsDataURL(blob);});

// ── splitPdfIfNeeded and mergePdfsWithLimit REMOVED — PDFs now processed locally with pdf.js
// Legacy references kept as no-ops for any remaining dead code paths
async function splitPdfIfNeeded(file){return[{file,name:file.name,pages:`1–?`,total:1}];}
async function mergePdfsWithLimit(blobs){return{file:blobs[0],pages:0};
}

// ── Theme — Dark Mode ────────────────────────────────────────────────────────
// ── Theme: light + dark mode ─────────────────────────────────────────────
const LIGHT={
  bg:'#f0f7f5',surface:'#ffffff',card:'#ffffff',
  border:'#c8e0db',border2:'#a8d0c8',
  text:'#1a2e2b',muted:'#5a7a75',dim:'#8aa8a2',
  blue:'#2a9d8f',blueDk:'#238577',blueS:'#e8f4f1',blueText:'#1a6b60',
  green:'#52b788',greenDk:'#3a9a6e',greenS:'#e6f5ee',greenText:'#2d7a54',
  teal:'#2a9d8f',tealDk:'#238577',tealS:'#e8f4f1',tealText:'#1a6b60',
  amber:'#e9c46a',amberS:'#fdf6e3',amberText:'#8a6d1b',
  red:'#e76f51',redDk:'#d4533a',redS:'#fdf0ec',redText:'#a33d28',
  purple:'#7c5cbf',purpleDk:'#6345a5',purpleS:'#f0ecf8',purpleText:'#5a3d96',
  orange:'#e76f51',orangeS:'#fdf0ec',orangeText:'#a33d28',
};
const DARK={
  bg:'#0f1f1c',surface:'#1a2e2a',card:'#1a2e2a',
  border:'#2a4a42',border2:'#3a5a50',
  text:'#e8f4f1',muted:'#8ab0a8',dim:'#5a8a80',
  blue:'#2a9d8f',blueDk:'#3ab8a8',blueS:'#1a302c',blueText:'#5eced0',
  green:'#52b788',greenDk:'#6ed4a0',greenS:'#1a302a',greenText:'#86efb0',
  teal:'#2a9d8f',tealDk:'#3ab8a8',tealS:'#1a302c',tealText:'#5eced0',
  amber:'#e9c46a',amberS:'#2a2818',amberText:'#f0d880',
  red:'#e76f51',redDk:'#f08870',redS:'#2a1a18',redText:'#f0a090',
  purple:'#a78bfa',purpleDk:'#b8a0ff',purpleS:'#1a1a2e',purpleText:'#c8b8ff',
  orange:'#e76f51',orangeS:'#2a1a18',orangeText:'#f0a090',
};
// Auto dark mode: 21:00-7:00
const isNightTime=()=>{const h=new Date().getHours();return h>=21||h<7;};
let T=LIGHT; // mutable — gets swapped by App on mount
const FONT="system-ui,-apple-system,sans-serif";
const sh={sm:'0 1px 3px rgba(26,46,43,.06)',md:'0 4px 12px rgba(26,46,43,.08)',lg:'0 8px 24px rgba(26,46,43,.1)'};

// ── Global session timer store (survives component unmount/remount) ──────
// Key: "topic::sectionIdx" or "topic::sectionIdx-subIdx"
// Value: { startTs: number (Date.now() when pretest began), pausedAt: number|null, accumulated: number (ms paused) }
const _sessionTimers=new Map();

// ── Sections ─────────────────────────────────────────────────────────────────
const SECTIONS=[
  {id:'comun',name:'Temario Común y Legislación',emoji:'⚖️',color:'#2a9d8f',colorS:'#e8f4f1',colorBorder:'#b0d8d0',desc:'Constitución, autonomía CLM, leyes sanitarias, SESCAM, legislación laboral y ética',tietz:'—',henry:'—',temas:[1,2,3,4,5,6],
   topics:['T1. Constitución Española: derechos fundamentales y protección de la salud','T1. Estatuto de Autonomía CLM: instituciones y competencias de la Junta. Igualdad y violencia de género','T2. Ley General de Sanidad: organización del SNS, áreas de salud, CCAA','T2. SESCAM: funciones, organización y estructura. Ley de Ordenación Sanitaria CLM','T3. Ley de cohesión y calidad del SNS: prestaciones, garantías, Consejo Interterritorial','T4. Estatuto Marco del personal estatutario. Ley de Prevención de Riesgos Laborales','T5. Ley de derechos y deberes en salud CLM. Documentación sanitaria (Decreto 24/2011)','T6. Plan Dignifica SESCAM: humanización de la asistencia. Estratificación de crónicos']},
  {id:'fundamentos',name:'Fundamentos del Laboratorio',emoji:'🏛️',color:T.blue,colorS:T.blueS,colorBorder:'#b0d8d0',desc:'Preanalítica, control de calidad, postanalítica, estadística, gestión, ISO 15189, SIL, instrumentación',tietz:'Secc. I–II caps. 1–9, 16–30',henry:'Parte 1 caps. 1–14',temas:[7,8,9,10,11,12,13,14],
   topics:['T7. Fase preanalítica: obtención, transporte, conservación y criterios de rechazo de muestras','T8. Control de calidad analítico: CCI, PECS/EQA, reglas de Westgard, Seis Sigma, variabilidad biológica','T9. Fase postanalítica: informe del laboratorio, valores de referencia, valores críticos, valor del cambio','T10. Bioestadística: descriptiva, inferencial, correlación, evaluación de pruebas diagnósticas (Se/Sp/VPP/VPN)','T11. Gestión del laboratorio clínico: gestión por procesos, RRHH, indicadores, cuadros de mando','T12. Modelos de gestión de calidad: ISO 15189, Joint Commission, EFQM. Bioética, protección de datos','T13. SIL, inteligencia artificial, Big Data y ciberseguridad en el laboratorio clínico','T14. Principios metodológicos: espectrofotometría, electroforesis, cromatografía, masas, POCT, automatización']},
  {id:'bioquimica',name:'Bioquímica Clínica',emoji:'🧬',color:T.purple,colorS:T.purpleS,colorBorder:'#c8b8e0',desc:'Gases, riñón, mineral, glucosa, lípidos, proteínas, hígado, corazón, inflamación, endocrinología, fármacos',tietz:'Secc. III–IV caps. 31–51',henry:'Parte 2 caps. 15–28',temas:[15,16,17,18,19,20,21,22,23,24,25,26,27],
   topics:['T15. Equilibrio ácido-base y gases sanguíneos: fisiología, gasometría arterial, cooximetría','T16. Función renal y equilibrio hidroelectrolítico: FGe, proteinuria, osmolalidad, patología tubular','T17. Metabolismo mineral: hierro, calcio, magnesio, fósforo, metabolismo óseo y vitamina D','T18. Hidratos de carbono: metabolismo glucídico, diabetes mellitus, HbA1c, insulina, péptido C','T19. Lípidos y lipoproteínas: dislipemias, síndrome metabólico, riesgo cardiovascular','T20. Proteínas plasmáticas: electroforesis, paraproteínas, cadenas ligeras libres, enzimología, porfirias','T21. Función hepatobiliar: marcadores, hepatopatía aguda y crónica, índices de fibrosis, autoinmunidad hepática','T22. Función cardiaca y muscular: troponinas, BNP, síndrome coronario agudo, insuficiencia cardíaca','T23. Marcadores de inflamación y sepsis: PCR, PCT, IL-6, ferritina, dímero D','T24. Función gastrointestinal: páncreas, malabsorción, EII, estudio de heces, sangre oculta','T25. Marcadores tumorales: PSA, AFP, CEA, CA 125, CA 19-9; biopsia líquida, ADN circulante','T26. Función endocrina: hipotálamo-hipófisis, tiroides, paratiroides, suprarrenal, hormonas sexuales','T27. Monitorización de fármacos: farmacocinética, fármacos biológicos, drogas de abuso, intoxicaciones']},
  {id:'liquidos',name:'Orina, Líquidos y Reproducción',emoji:'💧',color:'#4da8c4',colorS:'#e8f2f8',colorBorder:'#b0d0e0',desc:'Análisis de orina, líquidos biológicos, seminograma, reproducción asistida y cribado prenatal',tietz:'Cap. 45, 58–59',henry:'Parte 3 caps. 29–30',temas:[28,29,30,31],
   topics:['T28. Estudio de la orina: análisis bioquímico, sedimento urinario, litiasis renal','T29. Líquidos biológicos: ascítico, cefalorraquídeo, pleural, amniótico, pericárdico, sinovial','T30. Líquido seminal: seminograma (criterios OMS), FIV, ICSI, inseminación artificial, donación de gametos','T31. Embarazo: cribado bioquímico de cromosomopatías, DPNI, trastornos hipertensivos del embarazo']},
  {id:'hematologia',name:'Hematología',emoji:'🩸',color:T.red,colorS:T.redS,colorBorder:'#e0b8b0',desc:'Hemograma, hematopoyesis, eritrocitos, leucocitos neoplásicos y no neoplásicos, plaquetas',tietz:'Secc. VII caps. 74–78',henry:'Parte 4 caps. 31–35',temas:[32,33,34,35,36,37],
   topics:['T32. Hemograma: principios de automatización, tinción y morfología de frotis sanguíneo, VSG','T33. Hematopoyesis: médula ósea, eritropoyesis, leucopoyesis, trombopoyesis','T34. Patologías eritrocitarias: anemias, hemoglobinopatías, talasemias, poliglobulias','T35. Trastornos leucocitarios no neoplásicos: alteraciones en granulocitos, linfocitos, monocitos, eosinófilos','T36. Trastornos leucocitarios neoplásicos: leucemias, linfomas, mieloma múltiple, SMD, síndromes mieloproliferativos','T37. Trastornos plaquetarios: trombocitopenias, trombocitosis y disfunción plaquetaria']},
  {id:'hemostasia',name:'Hemostasia y Transfusión',emoji:'🔴',color:T.orange,colorS:T.orangeS,colorBorder:'#e0c0b0',desc:'Coagulación, fibrinólisis, anticoagulación, inmunohematología y medicina transfusional',tietz:'Caps. 79–81, 90–93',henry:'Parte 4–5 caps. 36–43',temas:[38,39],
   topics:['T38. Hemostasia y trombosis: factores de coagulación, TP/TTPA/fibrinógeno, fibrinólisis, anticoagulantes (NACO)','T38. Trombofilia: estudio de trombosis venosa y arterial. Control del tratamiento anticoagulante','T39. Inmunohematología: sistemas ABO y Rh, anticuerpos irregulares, prueba de Coombs, crossmatch','T39. Medicina transfusional: componentes sanguíneos, indicaciones, reacciones adversas, hemovigilancia']},
  {id:'microbiologia',name:'Microbiología',emoji:'🦠',color:T.green,colorS:T.greenS,colorBorder:'#b0d8c0',desc:'Bacteriología, micobacterias, hongos, parásitos, virus, serología y patologías infecciosas',tietz:'Secc. VIII caps. 82–89',henry:'Parte 7 caps. 57–66',temas:[40,41,42,43,44,45,46,47,48,49,50],
   topics:['T40. Muestras microbiológicas: obtención, procesamiento, medios de cultivo, tinciones','T41. Identificación microbiológica: antibiograma (EUCAST/CLSI), mecanismos de resistencia, MALDI-TOF','T42. Bacterias aerobias de interés clínico: Gram positivos y Gram negativos','T43. Bacterias anaerobias: Clostridium, Bacteroides, Actinomyces, diagnóstico y clínica','T44. Micobacterias: M. tuberculosis, NTM, Ziehl-Neelsen, MGIT 960, IGRA, PCR, tratamiento','T45. Otros microorganismos: micoplasmas, espiroquetas, clamidias, rickettsias, enfermedades emergentes','T46. Micología: levaduras (Candida, Cryptococcus), hongos filamentosos (Aspergillus), antifúngicos','T47. Parasitología: técnicas de diagnóstico, parásitos de interés clínico, tratamiento antiparasitario','T48. Virología: VIH, hepatitis A/B/C, virus respiratorios, PCR en tiempo real, priones','T49. Diagnóstico serológico: detección de antígenos y anticuerpos, pruebas de cribado y confirmación','T50. Patologías infecciosas: sepsis, infecciones nosocomiales, meningitis, ITS, paciente inmunodeprimido']},
  {id:'molecular',name:'Biología Molecular y Genética',emoji:'🧪',color:T.teal,colorS:T.tealS,colorBorder:'#b0d8d0',desc:'Genética humana, citogenética, farmacogenómica y biología molecular diagnóstica',tietz:'Secc. VI caps. 62–73',henry:'Parte 8 caps. 67–75',temas:[51,52,53,54],
   topics:['T51. Genética humana: mutaciones, patrones de herencia, árboles genealógicos','T52. Citogenética: cariotipo, anomalías cromosómicas estructurales y numéricas, diagnóstico prenatal y preimplantacional','T53. Genética aplicada: farmacogenética, cribado poblacional, bases moleculares del cáncer, medicina de precisión','T54. Biología molecular diagnóstica: PCR, NGS, hibridación, array-CGH, exomas, biopsia líquida']},
  {id:'inmunologia',name:'Inmunología',emoji:'🛡️',color:'#2a9d8f',colorS:'#e8f4f1',colorBorder:'#b0d8d0',desc:'Sistema inmune, HLA y trasplante, alergias, autoinmunidad sistémica y de órgano, inmunodeficiencias',tietz:'Secc. X caps. 94–100',henry:'Parte 6 caps. 44–56',temas:[55,56,57,58,59,60],
   topics:['T55. Inmunología: sistema inmunitario, complemento, citometría de flujo, poblaciones leucocitarias','T56. Histocompatibilidad: HLA, técnicas de tipificación, trasplante de órganos y tejidos','T57. Enfermedades alérgicas: IgE total y específica, mecanismos de hipersensibilidad, anafilaxia, enfermedad celíaca','T58. Enfermedades autoinmunes órgano-específicas: autoanticuerpos (anti-TPO, anti-MBG, AMA, ANCA órgano-específicos)','T59. Enfermedades autoinmunes sistémicas: ANA, anti-dsDNA, anti-ENA, ANCA, FR, anti-CCP, algoritmos diagnósticos','T60. Inmunodeficiencias congénitas y adquiridas: clasificación, diagnóstico de laboratorio']},
];
const ALL_TOPICS=SECTIONS.flatMap(s=>s.topics);

// ── Mapeo tema SESCAM → capítulos Tietz & Henry ──────────────────────────────
// Tietz: Textbook of Laboratory Medicine (Rifai et al., 2022)
// Henry: El Laboratorio en el Diagnóstico Clínico (McPherson & Pincus, 2022)
const TOPIC_REFS={
  // ── Temario Común (sin referencia en los libros de laboratorio) ──────────
  'T1. Constitución Española: derechos fundamentales y protección de la salud':{tietz:'—',henry:'—'},
  'T1. Estatuto de Autonomía CLM: instituciones y competencias de la Junta. Igualdad y violencia de género':{tietz:'—',henry:'—'},
  'T2. Ley General de Sanidad: organización del SNS, áreas de salud, CCAA':{tietz:'—',henry:'—'},
  'T2. SESCAM: funciones, organización y estructura. Ley de Ordenación Sanitaria CLM':{tietz:'—',henry:'—'},
  'T3. Ley de cohesión y calidad del SNS: prestaciones, garantías, Consejo Interterritorial':{tietz:'—',henry:'—'},
  'T4. Estatuto Marco del personal estatutario. Ley de Prevención de Riesgos Laborales':{tietz:'—',henry:'—'},
  'T5. Ley de derechos y deberes en salud CLM. Documentación sanitaria (Decreto 24/2011)':{tietz:'—',henry:'—'},
  'T6. Plan Dignifica SESCAM: humanización de la asistencia. Estratificación de crónicos':{tietz:'—',henry:'—'},
  // ── Fundamentos ─────────────────────────────────────────────────────────
  'T7. Fase preanalítica: obtención, transporte, conservación y criterios de rechazo de muestras':{
    tietz:'Caps. 4–5',tietzD:'Cap.4 Specimen Collection · Cap.5 Preanalytical Variation',
    henry:'Cap. 3',henryD:'Cap.3 Fase preanalítica'},
  'T8. Control de calidad analítico: CCI, PECS/EQA, reglas de Westgard, Seis Sigma, variabilidad biológica':{
    tietz:'Caps. 6, 8',tietzD:'Cap.6 Quality Control · Cap.8 Biological Variation & Analytical Performance Specs',
    henry:'Cap. 11',henryD:'Cap.11 Control de calidad'},
  'T9. Fase postanalítica: informe del laboratorio, valores de referencia, valores críticos, valor del cambio':{
    tietz:'Caps. 2, 9',tietzD:'Cap.2 Statistical Methodologies · Cap.9 Reference Intervals',
    henry:'Caps. 8–9',henryD:'Cap.8 Fase postanalítica · Cap.9 Interpretación de resultados'},
  'T10. Bioestadística: descriptiva, inferencial, correlación, evaluación de pruebas diagnósticas (Se/Sp/VPP/VPN)':{
    tietz:'Cap. 2',tietzD:'Cap.2 Statistical Methodologies in Laboratory Medicine',
    henry:'Cap. 10',henryD:'Cap.10 Estadísticas de laboratorio'},
  'T11. Gestión del laboratorio clínico: gestión por procesos, RRHH, indicadores, cuadros de mando':{
    tietz:'Caps. 3, 14',tietzD:'Cap.3 Governance, Risk and Quality Management · Cap.14 Laboratory Stewardship',
    henry:'Caps. 1–2, 13',henryD:'Cap.1 Conceptos generales · Cap.2 Optimización del flujo · Cap.13 Gestión económica'},
  'T12. Modelos de gestión de calidad: ISO 15189, Joint Commission, EFQM. Bioética, protección de datos':{
    tietz:'Caps. 3, 7',tietzD:'Cap.3 Governance & Quality · Cap.7 Standardization and Harmonization',
    henry:'Caps. 1, 14',henryD:'Cap.1 Conceptos generales · Cap.14 Ética en la medicina de laboratorio'},
  'T13. SIL, inteligencia artificial, Big Data y ciberseguridad en el laboratorio clínico':{
    tietz:'Caps. 13, 29',tietzD:'Cap.13 Machine Learning & Big Data · Cap.29 Automation in the Clinical Laboratory',
    henry:'Cap. 12',henryD:'Cap.12 Informática del laboratorio clínico'},
  'T14. Principios metodológicos: espectrofotometría, electroforesis, cromatografía, masas, POCT, automatización':{
    tietz:'Caps. 16–20, 26, 28–30',tietzD:'Cap.16 Optical · Cap.17 Electrochemistry · Cap.18 Electrophoresis · Cap.19 Chromatography · Cap.20 Mass Spectrometry · Cap.26 Immunochemical · Cap.28 Cytometry · Cap.29 Automation · Cap.30 POCT',
    henry:'Caps. 4–7',henryD:'Cap.4 Instrumentación · Cap.5 Espectrometría de masas · Cap.6 Automatización · Cap.7 POCT'},
  // ── Bioquímica Clínica ──────────────────────────────────────────────────
  'T15. Equilibrio ácido-base y gases sanguíneos: fisiología, gasometría arterial, cooximetría':{
    tietz:'Caps. 37, 50',tietzD:'Cap.37 Electrolytes and Blood Gases · Cap.50 Disorders of Water, Electrolytes and Acid-Base',
    henry:'Cap. 15',henryD:'Cap.15 Función renal, agua, electrólitos y equilibrio acidobásico'},
  'T16. Función renal y equilibrio hidroelectrolítico: FGe, proteinuria, osmolalidad, patología tubular':{
    tietz:'Caps. 34, 49–50',tietzD:'Cap.34 Kidney Function Tests · Cap.49 Kidney Disease · Cap.50 Disorders of Water/Electrolytes',
    henry:'Cap. 15',henryD:'Cap.15 Evaluación de la función renal, agua, electrólitos y equilibrio acidobásico'},
  'T17. Metabolismo mineral: hierro, calcio, magnesio, fósforo, metabolismo óseo y vitamina D':{
    tietz:'Caps. 39–40, 54',tietzD:'Cap.39 Vitamins and Trace Elements · Cap.40 Iron Metabolism · Cap.54 Bone and Mineral Metabolism',
    henry:'Caps. 16, 27',henryD:'Cap.16 Marcadores bioquímicos del metabolismo óseo · Cap.27 Vitaminas y oligoelementos'},
  'T18. Hidratos de carbono: metabolismo glucídico, diabetes mellitus, HbA1c, insulina, péptido C':{
    tietz:'Caps. 35, 47',tietzD:'Cap.35 Carbohydrates · Cap.47 Diabetes Mellitus',
    henry:'Cap. 17',henryD:'Cap.17 Hidratos de carbono'},
  'T19. Lípidos y lipoproteínas: dislipemias, síndrome metabólico, riesgo cardiovascular':{
    tietz:'Cap. 36',tietzD:'Cap.36 Lipids and Lipoproteins',
    henry:'Caps. 18–19',henryD:'Cap.18 Lípidos y dislipoproteinemia · Cap.19 Lesión cardíaca, ateroesclerosis y enfermedad trombótica'},
  'T20. Proteínas plasmáticas: electroforesis, paraproteínas, cadenas ligeras libres, enzimología, porfirias':{
    tietz:'Caps. 31–32, 41',tietzD:'Cap.31 Amino Acids, Peptides & Proteins · Cap.32 Serum Enzymes · Cap.41 Porphyrins and Porphyrias',
    henry:'Caps. 20–21',henryD:'Cap.20 Proteínas específicas · Cap.21 Enzimología clínica'},
  'T21. Función hepatobiliar: marcadores, hepatopatía aguda y crónica, índices de fibrosis, autoinmunidad hepática':{
    tietz:'Cap. 51',tietzD:'Cap.51 Liver Disease',
    henry:'Cap. 22',henryD:'Cap.22 Evaluación de la función hepática'},
  'T22. Función cardiaca y muscular: troponinas, BNP, síndrome coronario agudo, insuficiencia cardíaca':{
    tietz:'Cap. 48',tietzD:'Cap.48 Cardiac Function',
    henry:'Cap. 19',henryD:'Cap.19 Lesión cardíaca, ateroesclerosis y enfermedad trombótica'},
  'T23. Marcadores de inflamación y sepsis: PCR, PCT, IL-6, ferritina, dímero D':{
    tietz:'Caps. 31, 82',tietzD:'Cap.31 Proteins (PCR, ferritina) · Cap.82 Introduction to Infectious Diseases (sepsis)',
    henry:'Cap. 20',henryD:'Cap.20 Proteínas específicas (PCR, reactantes de fase aguda)'},
  'T24. Función gastrointestinal: páncreas, malabsorción, EII, estudio de heces, sangre oculta':{
    tietz:'Cap. 52',tietzD:'Cap.52 Gastric, Intestinal, and Pancreatic Function',
    henry:'Cap. 23',henryD:'Cap.23 Diagnóstico de laboratorio de los trastornos digestivos y pancreáticos'},
  'T25. Marcadores tumorales: PSA, AFP, CEA, CA 125, CA 19-9; biopsia líquida, ADN circulante':{
    tietz:'Caps. 33, 71',tietzD:'Cap.33 Tumor Markers · Cap.71 Circulating Tumor Cells and Circulating Nucleic Acids in Oncology',
    henry:'Cap. 76',henryD:'Cap.76 Diagnóstico y tratamiento del cáncer mediante marcadores serológicos y de otros líquidos'},
  'T26. Función endocrina: hipotálamo-hipófisis, tiroides, paratiroides, suprarrenal, hormonas sexuales':{
    tietz:'Caps. 38, 55–58',tietzD:'Cap.38 Hormones · Cap.55 Pituitary · Cap.56 Adrenal Cortex · Cap.57 Thyroid · Cap.58 Reproductive Endocrinology',
    henry:'Caps. 25–26',henryD:'Cap.25 Evaluación de la función endocrina · Cap.26 Función reproductora y embarazo'},
  'T27. Monitorización de fármacos: farmacocinética, fármacos biológicos, drogas de abuso, intoxicaciones':{
    tietz:'Caps. 42–44',tietzD:'Cap.42 Therapeutic Drugs and Their Management · Cap.43 Clinical Toxicology · Cap.44 Toxic Elements',
    henry:'Cap. 24',henryD:'Cap.24 Toxicología y monitorización de los medicamentos'},
  // ── Orina, Líquidos y Reproducción ─────────────────────────────────────
  'T28. Estudio de la orina: análisis bioquímico, sedimento urinario, litiasis renal':{
    tietz:'Cap. 45',tietzD:'Cap.45 Body Fluids (sección orina)',
    henry:'Cap. 29',henryD:'Cap.29 Análisis básico de la orina'},
  'T29. Líquidos biológicos: ascítico, cefalorraquídeo, pleural, amniótico, pericárdico, sinovial':{
    tietz:'Cap. 45',tietzD:'Cap.45 Body Fluids',
    henry:'Cap. 30',henryD:'Cap.30 Líquidos cefalorraquídeo, sinovial, seroso y muestras alternativas'},
  'T30. Líquido seminal: seminograma (criterios OMS), FIV, ICSI, inseminación artificial, donación de gametos':{
    tietz:'Cap. 58',tietzD:'Cap.58 Reproductive Endocrinology and Related Disorders',
    henry:'Cap. 26',henryD:'Cap.26 Función reproductora y embarazo'},
  'T31. Embarazo: cribado bioquímico de cromosomopatías, DPNI, trastornos hipertensivos del embarazo':{
    tietz:'Caps. 59, 72',tietzD:'Cap.59 Pregnancy and Its Disorders · Cap.72 Circulating Nucleic Acids for Prenatal Diagnostics',
    henry:'Cap. 26',henryD:'Cap.26 Función reproductora y embarazo'},
  // ── Hematología ─────────────────────────────────────────────────────────
  'T32. Hemograma: principios de automatización, tinción y morfología de frotis sanguíneo, VSG':{
    tietz:'Caps. 74–76',tietzD:'Cap.74 Automated Hematology · Cap.75 Leukocyte Morphology · Cap.76 Red Blood Cell Morphology and Indices',
    henry:'Cap. 31',henryD:'Cap.31 Examen básico de la sangre y la médula ósea'},
  'T33. Hematopoyesis: médula ósea, eritropoyesis, leucopoyesis, trombopoyesis':{
    tietz:'Cap. 74',tietzD:'Cap.74 Automated Hematology (sección hematopoyesis)',
    henry:'Cap. 32',henryD:'Cap.32 Hematopoyesis'},
  'T34. Patologías eritrocitarias: anemias, hemoglobinopatías, talasemias, poliglobulias':{
    tietz:'Caps. 76–78',tietzD:'Cap.76 Red Blood Cell Morphology · Cap.77 Hemoglobin and Hemoglobinopathies · Cap.78 Enzymes of the Red Blood Cell',
    henry:'Cap. 33',henryD:'Cap.33 Trastornos eritrocíticos'},
  'T35. Trastornos leucocitarios no neoplásicos: alteraciones en granulocitos, linfocitos, monocitos, eosinófilos':{
    tietz:'Cap. 75',tietzD:'Cap.75 Leukocyte Morphology in Blood and Bone Marrow',
    henry:'Cap. 34',henryD:'Cap.34 Trastornos leucocíticos'},
  'T36. Trastornos leucocitarios neoplásicos: leucemias, linfomas, mieloma múltiple, SMD, síndromes mieloproliferativos':{
    tietz:'Caps. 70, 75',tietzD:'Cap.70 Hematopathology · Cap.75 Leukocyte Morphology',
    henry:'Caps. 34–35',henryD:'Cap.34 Trastornos leucocíticos · Cap.35 Citometría de flujo en neoplasias hematopoyéticas'},
  'T37. Trastornos plaquetarios: trombocitopenias, trombocitosis y disfunción plaquetaria':{
    tietz:'Cap. 80',tietzD:'Cap.80 Platelets and von Willebrand Factor',
    henry:'Cap. 41',henryD:'Cap.41 Trastornos plaquetarios y enfermedad de von Willebrand'},
  // ── Hemostasia y Transfusión ────────────────────────────────────────────
  'T38. Hemostasia y trombosis: factores de coagulación, TP/TTPA/fibrinógeno, fibrinólisis, anticoagulantes (NACO)':{
    tietz:'Caps. 79, 81',tietzD:'Cap.79 Physiology of Hemostasis · Cap.81 Coagulation, Anticoagulation, and Fibrinolysis',
    henry:'Cap. 40',henryD:'Cap.40 Coagulación y fibrinólisis'},
  'T38. Trombofilia: estudio de trombosis venosa y arterial. Control del tratamiento anticoagulante':{
    tietz:'Cap. 81',tietzD:'Cap.81 Coagulation, Anticoagulation, and Fibrinolysis',
    henry:'Caps. 42–43',henryD:'Cap.42 Enfoque de laboratorio del riesgo trombótico · Cap.43 Tratamiento antitrombótico'},
  'T39. Inmunohematología: sistemas ABO y Rh, anticuerpos irregulares, prueba de Coombs, crossmatch':{
    tietz:'Caps. 90–91',tietzD:'Cap.90 Blood Group Systems and Pretransfusion Testing · Cap.91 Blood Components',
    henry:'Cap. 36',henryD:'Cap.36 Inmunohematología'},
  'T39. Medicina transfusional: componentes sanguíneos, indicaciones, reacciones adversas, hemovigilancia':{
    tietz:'Caps. 92–93',tietzD:'Cap.92 Indications for Transfusion · Cap.93 Transfusion Reactions and Adverse Events',
    henry:'Cap. 37',henryD:'Cap.37 Medicina transfusional'},
  // ── Microbiología ───────────────────────────────────────────────────────
  'T40. Muestras microbiológicas: obtención, procesamiento, medios de cultivo, tinciones':{
    tietz:'Caps. 82–83',tietzD:'Cap.82 Introduction to Infectious Diseases · Cap.83 Clinical Laboratory in Infection Prevention',
    henry:'Cap. 66',henryD:'Cap.66 Recogida y manipulación de muestras para el diagnóstico de enfermedades infecciosas'},
  'T41. Identificación microbiológica: antibiograma (EUCAST/CLSI), mecanismos de resistencia, MALDI-TOF':{
    tietz:'Caps. 84–85',tietzD:'Cap.84 Bacteriology · Cap.85 Antimicrobial Susceptibility Testing',
    henry:'Caps. 57–58',henryD:'Cap.57 Bacteriología médica · Cap.58 Pruebas in vitro de agentes antimicrobianos'},
  'T42. Bacterias aerobias de interés clínico: Gram positivos y Gram negativos':{
    tietz:'Cap. 84',tietzD:'Cap.84 Bacteriology',
    henry:'Cap. 57',henryD:'Cap.57 Bacteriología médica'},
  'T43. Bacterias anaerobias: Clostridium, Bacteroides, Actinomyces, diagnóstico y clínica':{
    tietz:'Cap. 84',tietzD:'Cap.84 Bacteriology (sección anaerobes)',
    henry:'Cap. 57',henryD:'Cap.57 Bacteriología médica (sección anaerobios)'},
  'T44. Micobacterias: M. tuberculosis, NTM, Ziehl-Neelsen, MGIT 960, IGRA, PCR, tratamiento':{
    tietz:'Cap. 86',tietzD:'Cap.86 Mycobacteriology',
    henry:'Cap. 59',henryD:'Cap.59 Micobacterias'},
  'T45. Otros microorganismos: micoplasmas, espiroquetas, clamidias, rickettsias, enfermedades emergentes':{
    tietz:'Cap. 82',tietzD:'Cap.82 Introduction to Infectious Diseases',
    henry:'Caps. 61–63',henryD:'Cap.61 Espiroquetas · Cap.62 Clamidias y micoplasmas · Cap.63 Rickettsias'},
  'T46. Micología: levaduras (Candida, Cryptococcus), hongos filamentosos (Aspergillus), antifúngicos':{
    tietz:'Cap. 87',tietzD:'Cap.87 Mycology',
    henry:'Cap. 60',henryD:'Cap.60 Enfermedades micóticas'},
  'T47. Parasitología: técnicas de diagnóstico, parásitos de interés clínico, tratamiento antiparasitario':{
    tietz:'Cap. 88',tietzD:'Cap.88 Parasitology',
    henry:'Cap. 65',henryD:'Cap.65 Parasitología médica'},
  'T48. Virología: VIH, hepatitis A/B/C, virus respiratorios, PCR en tiempo real, priones':{
    tietz:'Cap. 89',tietzD:'Cap.89 Virology',
    henry:'Cap. 64',henryD:'Cap.64 Infecciones víricas'},
  'T49. Diagnóstico serológico: detección de antígenos y anticuerpos, pruebas de cribado y confirmación':{
    tietz:'Caps. 82, 89',tietzD:'Cap.82 Introduction to Infectious Diseases · Cap.89 Virology',
    henry:'Caps. 45, 64',henryD:'Cap.45 Inmunoensayos e inmunoquímica · Cap.64 Infecciones víricas'},
  'T50. Patologías infecciosas: sepsis, infecciones nosocomiales, meningitis, ITS, paciente inmunodeprimido':{
    tietz:'Caps. 82–83',tietzD:'Cap.82 Introduction to Infectious Diseases · Cap.83 Clinical Laboratory in Infection Prevention',
    henry:'Caps. 57–66',henryD:'Caps.57–66 Bacteriología, micobacterias, micología, parasitología, virología'},
  // ── Biología Molecular y Genética ───────────────────────────────────────
  'T51. Genética humana: mutaciones, patrones de herencia, árboles genealógicos':{
    tietz:'Cap. 68',tietzD:'Cap.68 Genetics',
    henry:'Cap. 72',henryD:'Cap.72 Diagnóstico molecular de las enfermedades genéticas'},
  'T52. Citogenética: cariotipo, anomalías cromosómicas estructurales y numéricas, diagnóstico prenatal y preimplantacional':{
    tietz:'Cap. 68',tietzD:'Cap.68 Genetics (citogenética)',
    henry:'Cap. 71',henryD:'Cap.71 Aplicaciones de la citogenética en la patología moderna'},
  'T53. Genética aplicada: farmacogenética, cribado poblacional, bases moleculares del cáncer, medicina de precisión':{
    tietz:'Caps. 69, 73',tietzD:'Cap.69 Solid Tumors · Cap.73 Pharmacogenetics',
    henry:'Caps. 75, 76–79',henryD:'Cap.75 Farmacogenómica · Cap.76-79 Patología clínica del cáncer'},
  'T54. Biología molecular diagnóstica: PCR, NGS, hibridación, array-CGH, exomas, biopsia líquida':{
    tietz:'Caps. 62–65',tietzD:'Cap.62 Principles of Molecular Biology · Cap.63 Nucleic Acid Isolation · Cap.64 Nucleic Acid Techniques · Cap.65 Genomes, Variants & Massively Parallel Methods',
    henry:'Caps. 68–70',henryD:'Cap.68 Diagnóstico molecular: principios · Cap.69 PCR y amplificación · Cap.70 Tecnologías de hibridación'},
  // ── Inmunología ─────────────────────────────────────────────────────────
  'T55. Inmunología: sistema inmunitario, complemento, citometría de flujo, poblaciones leucocitarias':{
    tietz:'Caps. 94, 98',tietzD:'Cap.94 Systemic Autoimmune Disease · Cap.98 Monoclonal Antibody Therapeutics',
    henry:'Caps. 44, 46–48',henryD:'Cap.44 Introducción al sistema inmunitario · Cap.46 Inmunidad celular · Cap.47 Inmunoglobulinas · Cap.48 Complemento'},
  'T56. Histocompatibilidad: HLA, técnicas de tipificación, trasplante de órganos y tejidos':{
    tietz:'Caps. 95–97',tietzD:'Cap.95 Transplant Solid Organ · Cap.96 Hematopoietic Cell Transplantation · Cap.97 Transplant Compatibility Testing',
    henry:'Caps. 50–51',henryD:'Cap.50 Antígeno leucocítico humano (HLA) · Cap.51 Complejo principal de histocompatibilidad y enfermedad'},
  'T57. Enfermedades alérgicas: IgE total y específica, mecanismos de hipersensibilidad, anafilaxia, enfermedad celíaca':{
    tietz:'Cap. 99',tietzD:'Cap.99 Allergy Testing',
    henry:'Cap. 56',henryD:'Cap.56 Enfermedades alérgicas'},
  'T58. Enfermedades autoinmunes órgano-específicas: autoanticuerpos (anti-TPO, anti-MBG, AMA, ANCA órgano-específicos)':{
    tietz:'Cap. 94',tietzD:'Cap.94 Systemic Autoimmune Disease (sección órgano-específica)',
    henry:'Cap. 55',henryD:'Cap.55 Enfermedades autoinmunitarias específicas de órganos'},
  'T59. Enfermedades autoinmunes sistémicas: ANA, anti-dsDNA, anti-ENA, ANCA, FR, anti-CCP, algoritmos diagnósticos':{
    tietz:'Cap. 94',tietzD:'Cap.94 Systemic Autoimmune Disease',
    henry:'Caps. 53–54',henryD:'Cap.53 Evaluación de enfermedades reumáticas autoinmunitarias sistémicas · Cap.54 Vasculitis'},
  'T60. Inmunodeficiencias congénitas y adquiridas: clasificación, diagnóstico de laboratorio':{
    tietz:'Cap. 100',tietzD:'Cap.100 Primary Immunodeficiencies and Secondary Immunodeficiencies',
    henry:'Cap. 52',henryD:'Cap.52 Inmunodeficiencias'},
};

// ── Texto oficial DOCM (Anexo II, 9/04/2025) ─────────────────────────────────
const TOPIC_OFFICIAL={
  1:`La Constitución Española: Derechos y deberes fundamentales. La protección de la salud en la Constitución. El Estatuto de Autonomía de Castilla-La Mancha: Instituciones de la Comunidad Autónoma de Castilla-La Mancha. Competencias de la Junta de Comunidades de Castilla-La Mancha. La igualdad efectiva entre hombres y mujeres. Políticas de igualdad. Medidas de protección integral contra la violencia de género.`,
  2:`Ley General de Sanidad: Organización general del Sistema Sanitario Público. Los Servicios de Salud de las Comunidades Autónomas y las Áreas de Salud. Ley de Ordenación Sanitaria de Castilla-La Mancha: Disposiciones generales. Plan de Salud de Castilla-La Mancha. Competencias de las Administraciones Públicas: El Servicio de Salud de Castilla-La Mancha: funciones, organización y estructura.`,
  3:`Ley de cohesión y calidad del Sistema Nacional de Salud: Ordenación de prestaciones. Garantías de las prestaciones. Consejo Interterritorial. Ley de garantía de la atención sanitaria y del ejercicio de la libre elección en las prestaciones del Servicio de Salud de Castilla-La Mancha.`,
  4:`Estatuto Marco del personal estatutario de los servicios de salud. La Ley de Prevención de Riesgos Laborales: Derechos y obligaciones. Consulta y participación de los trabajadores. Plan Perseo: procedimiento de actuación ante una situación de violencia en el centro de trabajo. Resolución de 27/03/2024, de la Dirección-Gerencia, del procedimiento para la certificación negativa del Registro Central de Delincuentes Sexuales y de Trata de Seres Humanos del personal de las instituciones sanitarias del SESCAM.`,
  5:`Ley sobre derechos y deberes en materia de salud de Castilla-La Mancha. Documentación sanitaria en Castilla-La Mancha: Usos de la historia clínica (Decreto 24/2011, de 12/04/2011, de la documentación sanitaria en Castilla-La Mancha).`,
  6:`Planes estratégicos del SESCAM: Plan dignifica, humanización de la asistencia. Atención holística e integral del paciente y la familia. Estratificación de crónicos. Redes de Expertos y Profesionales del Sistema Sanitario de Castilla-La Mancha.`,
  7:`La fase preanalítica en las muestras biológicas humanas. Tipos de muestras biológicas. Obtención, recogida, transporte y criterios de conservación de muestras biológicas. Condiciones preanalíticas y variables intra e interindividuales. Normativa de transporte de muestras biológicas. Cadena de custodia. Criterios de rechazo de muestras biológicas. Protocolos de seguridad. Protocolos de distribución de muestras intralaboratorios.`,
  8:`Control de calidad analítico. Programas de control de calidad interno y programas de intercomparación. Error aleatorio, sistemático y total. Estrategias de decisión de validez de series analíticas. Evaluación, verificación y comparación de métodos. Materiales de referencia. Variabilidad biológica. Objetivos y especificaciones de calidad analítica. Gráficas y reglas de control de calidad. Metodología Seis sigma.`,
  9:`Fase postanalítica. Diseño del informe del laboratorio clínico. Niveles de decisión clínica. Validación facultativa. Test y algoritmos reflejos. Valores e intervalos de referencia. Tiempos de respuesta. Establecimiento y comunicación de valores críticos. Valor de referencia del cambio. Valor añadido. Interpretación de resultados y capacidad discriminante: sensibilidad, especificidad y eficiencia diagnóstica. Protocolos de custodia y almacenamiento de muestras.`,
  10:`Bioestadística de aplicación al laboratorio clínico. Estadística descriptiva e inferencial. Medidas de distribución y dispersión. Correlación y regresión. Pruebas paramétricas y no paramétricas. Contraste de hipótesis. Epidemiología. Metodología de investigación. Evaluación de pruebas diagnósticas: sensibilidad, especificidad y valores predictivos.`,
  11:`Gestión y organización del laboratorio clínico. Gestión por procesos. Gestión de recursos humanos y materiales. Procedimientos estandarizados. Indicadores de calidad. Estándares de calidad. Indicadores de resultado y de evaluación del desempeño. Gestión de costes y contabilidad analítica. Gestión y adecuación de la demanda. Tiempo de respuesta. Cuadros de mando.`,
  12:`Modelos de gestión de calidad. Normas ISO aplicables en el laboratorio clínico: certificación y acreditación. Modelos no normativos: Joint Commission y EFQM. Indicadores de gestión clínica. El secreto profesional: concepto y regulación jurídica. Protección de datos. Aspectos éticos y legales relacionados con el manejo de la información y la documentación. Seguridad del paciente. Segregación y gestión de residuos. Principios fundamentales de la Bioética.`,
  13:`Sistemas de Información del Laboratorio Clínico (SIL). El papel del laboratorio en los sistemas expertos de apoyo a la decisión clínica. Inteligencia artificial (IA) aplicada al laboratorio clínico. Sistemas de BIG DATA de aplicación al laboratorio clínico. Medicina de Laboratorio basada en la evidencia. Ciberseguridad en el Laboratorio. Cartera de servicios. Gestión del conocimiento.`,
  14:`Principios metodológicos e instrumentación del laboratorio clínico. Microscopía, fotometría, espectrofotometría, fluorescencia, espectrometría de masas, electroforesis, cromatografía, inmunoanálisis, citometría, quimioluminiscencia, química seca, nefelometría, turbidimetría y cinética enzimática. Técnicas de análisis de ácidos nucleicos. Interferencias analíticas. Automatización y robotización. Preparación de soluciones y reactivos. Gestión de pruebas a la cabecera del paciente (POCT).`,
  15:`Equilibrio acido-base y gases sanguíneos: mecanismos de compensación y regulación: renales y respiratorios. Fisiología y fisiopatología del transporte de gases. Gasometría arterial y venosa. Métodos de determinación. Cooximetría. Interpretación de los resultados de la gasometría.`,
  16:`Función renal y equilibrio hidro-electrolítico. Estimación del filtrado glomerular. Intermediarios metabólicos. Pruebas bioquímicas para el diagnóstico y/o seguimiento de las alteraciones de la función renal. Osmolalidad. Proteinuria. Estudio fisiopatológico de las alteraciones tubulares, glomerulares y del equilibrio hidro-electrolítico.`,
  17:`Metabolismo mineral. Homeostasis. Absorción, transporte, metabolismo y almacenamiento del hierro, calcio, magnesio, fosforo y otros iones inorgánicos. Pruebas de laboratorio utilizadas en las alteraciones del metabolismo fosfocálcico y del magnesio. Elementos traza. Patologías y desórdenes asociados. Estudio del metabolismo óseo: marcadores de remodelado, formación y resorción ósea. Monitorización, significación clínica y patologías relacionadas. Vitamina D.`,
  18:`Hidratos de carbono. Metabolismo de los glúcidos. Insulina, péptido C y glucagón. Pruebas de tolerancia a la glucosa. Diagnóstico y seguimiento de la diabetes mellitus. Hipoglucemia. Errores innatos del metabolismo de los hidratos de carbono. Diagnóstico de diabetes gestacional.`,
  19:`Lípidos y lipoproteínas. Estructura y metabolismo de los componentes lipídicos: Alteraciones en el metabolismo y transporte. Significado clínico de las dislipemias. Marcadores de obesidad. Síndrome metabólico y riesgo cardiovascular.`,
  20:`Proteínas plasmáticas. Estructura y metabolismo proteico. Patrones electroforéticos. Estudio y técnicas de interpretación de inmunoglobulinas y paraproteínas. Gammapatías monoclonales e hipergammaglobulinemias policlonales. Cadenas ligeras libres: relevancia diagnóstica y métodos de determinación. Reactantes de fase aguda. Evaluación del estado nutricional. Patrones de alteración proteica y su importancia clínica. Enzimología clínica. Principios y fundamentos de las determinaciones enzimáticas. Coenzimas. Utilidad de la determinación de enzimas en el laboratorio clínico. Estudio de las Porfirias.`,
  21:`Función hepatobiliar: marcadores de valoración de la función hepatobiliar. Enfermedad hepática aguda y crónica: diagnóstico y seguimiento. Utilidad clínica de los índices de fibrosis. Hepatopatías autoinmunes.`,
  22:`Estudio bioquímico de la función cardiaca y muscular. Fisiología y fisiopatología cardiovascular. Criterios y marcadores diagnósticos del síndrome coronario agudo, insuficiencia cardiaca y respiratoria. Marcadores de alteraciones endoteliales. Pruebas bioquímicas de utilidad en el diagnóstico precoz de las enfermedades neurodegenerativas.`,
  23:`Estudio de marcadores bioquímicos de inflamación y sepsis: diagnóstico, seguimiento y aplicabilidad clínica.`,
  24:`Estudio de la función gastrointestinal. Fisiología de la digestión y hormonas gastrointestinales. Indicadores bioquímicos del estado nutricional. Malabsorción. Marcadores pancreáticos. Enfermedad inflamatoria intestinal. Estudio de las heces. Digestión de principios inmediatos. Sangre oculta en heces.`,
  25:`Marcadores tumorales: sensibilidad y especificidad. Utilidad de los marcadores tumorales en la práctica clínica. Diagnóstico, seguimiento y pronóstico de enfermedades tumorales. Biopsia líquida. Detección de DNA circulante y su aplicación al cáncer.`,
  26:`Utilidad del laboratorio clínico en la evaluación de la función endocrina: bases fisiológicas. Características clínicas y pruebas bioquímicas. Sistema hipotálamo-hipofisiario, hormonas tiroideas y paratiroideas, hormonas de la corteza y glándula suprarrenal, hormonas sexuales y gastrointestinales. Significado clínico de su alteración.`,
  27:`Monitorización de fármacos. Principios de farmacología, farmacocinética y farmacodinamia. Monitorización de fármacos biológicos. Determinación de drogas de abuso. Custodia y análisis de muestras para la determinación de alcohol y drogas de abuso. Pruebas de laboratorio en intoxicaciones no medicamentosas: metales, toxinas y pesticidas.`,
  28:`Estudio de la orina en el laboratorio clínico. Examen básico de orina: análisis bioquímico de la orina y estudio del sedimento urinario. Litiasis renal y estudio de cálculos renales.`,
  29:`Estudio bioquímico y recuento citológico de líquidos biológicos (líquido ascítico, cefalorraquídeo, pleural, amniótico, pericárdico y sinovial). Interpretación de resultados.`,
  30:`Estudio del líquido seminal en el laboratorio de reproducción asistida: vasectomía, estudios de fertilidad, criterios actuales del Manual de la OMS para el estudio del seminograma. Fisiopatología de la fertilidad: fecundación, implantación y embriogénesis. Estudio de la pareja estéril. Infertilidad: alteraciones genéticas, procesos infecciosos, trastornos inmunológicos. Reproducción asistida. Técnicas de reproducción asistida. Capacitación espermática. Inseminación artificial, fecundación in vitro (FIV), microinyección espermática (ICSI). Conservación y congelación de células, gametos y embriones. Donación de gametos y embriones. Aspectos legales y éticos asociados a las técnicas de reproducción asistida.`,
  31:`Estudio del embarazo y de la función fetal por el laboratorio. Cribado bioquímico durante el embarazo para la detección de anomalías cromosómicas en el primer y segundo trimestre. Probabilidad del riesgo y cálculo del riesgo en cromosomopatías. Madurez pulmonar. Test prenatal no invasivo. Errores congénitos del metabolismo. Algoritmos en el estudio de trastornos hipertensivos del embarazo.`,
  32:`Examen básico de células sanguíneas. Principios de los sistemas automatizados en hematología. Técnicas de tinción y examen microscópico del frotis de sangre periférica. Morfología eritrocitaria, leucocitaria y plaquetaria. Velocidad de sedimentación glomerular.`,
  33:`Hematopoyesis. Estructura y función de la médula ósea y del tejido linfoide. Formación y proceso de maduración de las células sanguíneas. Eritropoyesis. Leucopoyesis. Trombopoyesis.`,
  34:`Patologías del sistema eritrocitario: alteraciones funcionales, cuantitativas y cualitativas. Diagnóstico por el laboratorio. Anemias. Hemoglobinopatías. Talasemias. Poliglobulias.`,
  35:`Trastornos leucocitarios no neoplásicos. Alteraciones en granulocitos, monocitos, linfocitos o eosinófilos.`,
  36:`Trastornos leucocitarios neoplásicos. Leucemias. Síndromes mieloproliferativos. Síndromes linfoproliferativos. Linfomas. Discrasias de células plasmáticas.`,
  37:`Trastornos de la función plaquetaria: trombocitopenias, trombocitosis y disfunción plaquetaria.`,
  38:`Hemostasia y trombosis. Factores de coagulación. Fisiología y diagnóstico por el laboratorio de las alteraciones en la coagulación y la fibrinolisis. Control del tratamiento anticoagulante y antitrombótico. Nuevos anticoagulantes orales.`,
  39:`Inmunohematología y medicina transfusional. Tipificación sanguínea AB0 y Rh. Fundamentos de la inmunohematología. Anticuerpos irregulares. Pruebas de compatibilidad. Reacciones adversas a la transfusión. Hemovigilancia.`,
  40:`Muestras microbiológicas: indicaciones, obtención, materiales de recogida, transporte y procesamiento. Criterios de aceptación y rechazo. Medios de cultivo, tinciones, técnicas de aislamiento e identificación. Distribución de la microbiota comensal y patógena según la localización anatómica.`,
  41:`Pruebas de identificación microbiológica: test rápidos. Pruebas de sensibilidad antibiótica: interpretación del antibiograma, automatización, control de calidad, informes de resultados. Identificación de microorganismos mediante espectrometría de masas.`,
  42:`Estudio de gérmenes aerobios: aislamiento e identificación. Microorganismos de interés clínico Gram (+) y Gram (-). Características generales. Clasificación y pruebas bioquímicas.`,
  43:`Estudio de gérmenes anaerobios: aislamiento e identificación. Microorganismos de interés clínico Gram (+) y Gram (-). Características generales. Clasificación y pruebas bioquímicas.`,
  44:`Micobacterias. Clasificación. Epidemiología. Patogenia. Procesamiento de muestras. Medios de cultivo e identificación, pruebas de laboratorio. Patología y tipos de infecciones provocadas por las micobacterias. Tratamiento, prevención y control.`,
  45:`Otros microorganismos de importancia clínica: micoplasmas, espiroquetas, clamydias, rickettsias, treponemas, borrelias y leptospira. Características generales, infecciones asociadas y diagnóstico. Enfermedades infecciosas emergentes.`,
  46:`Infecciones micóticas. Clasificación. Cultivos y tinciones de hongos. Interés clínico y características morfológicas e infecciosas de los hongos. Levaduras: identificación y estudio de sensibilidad. Fármacos antifúngicos.`,
  47:`Parasitología. Parásitos de interés clínico: tipos de muestras. Aspectos preanalíticos y diagnósticos de las parasitosis: procesamiento de muestras y examen directo. Tratamiento antiparasitario. Características morfológicas. Ciclo biológico.`,
  48:`Virus DNA y RNA de interés clínico: aislamiento y diagnóstico. Métodos de amplificación de ácidos nucleicos. PCR en tiempo real. Aportaciones de la microbiología molecular al diagnóstico. Estudio de VIH, hepatitis, virus respiratorios: pruebas de cribado y confirmación. Tratamiento, prevención y control. Enfermedades por priones.`,
  49:`Diagnostico serológico de infecciones bacterianas, virales, parasitarias y micóticas: pruebas de cribado y confirmación, detección de antígenos y anticuerpos. Interpretación de resultados. Marcadores serológicos.`,
  50:`Patologías infecciosas. Infecciones respiratorias. Infecciones en tracto genito-urinario. Infecciones gastrointestinales. Sepsis. Infecciones de transmisión sexual. Infecciones en vías respiratorias altas. Infecciones de piel y mucosas. Fiebre de origen desconocido. Infecciones nosocomiales. Meningitis. Pacientes inmunodeprimidos.`,
  51:`Genética Humana. Alteraciones genéticas. Mutaciones y su traducción clínica. Estudio de las proteínas codificadas por genes. Componentes genéticos y ambientales de las enfermedades comunes. Árboles genealógicos. Patrones de herencia. Riesgo de ocurrencia o recurrencia de una enfermedad. Bases especializadas en genética.`,
  52:`Citogenética humana. Técnicas. Mapas genéticos. Anomalías cromosómicas estructurales y numéricas. Diagnóstico prenatal de trastornos genéticos y defectos congénitos. Diagnóstico genético preimplantacional de aneuploidías, enfermedades monogénicas y estructurales. Consejo y asesoramiento genético. Tratamiento de muestras con material genético con fines de investigación.`,
  53:`Genética aplicada: epidemiología y modelos genéticos, variación genética y susceptibilidad a la enfermedad. Cribado poblacional de enfermedades genéticas y anomalías congénitas. Estudio de portadores. Bases moleculares del cáncer esporádico y familiar. Estudios de farmacogenética. Medicina personalizada de precisión: prevención, detección precoz, diagnóstico y tratamiento. Pruebas de laboratorio asociadas.`,
  54:`Bases moleculares de las enfermedades hereditarias: diagnósticos moleculares. Extracción y amplificación de ácidos nucleicos. ADN circulante. Biopsia líquida. Estudios moleculares dirigidos. Reacción en cadena de la polimerasa (PCR). Secuenciación masiva. Tecnologías de hibridación. Array-CGH. Paneles. Exomas.`,
  55:`Inmunología. El sistema inmunitario en condiciones de salud. Componentes del sistema inmunitario. El tejido linfoide. Células implicadas en la respuesta inmune, proliferación celular y maduración, interacción celular, componentes moleculares de la respuesta inmune. Sistema del complemento. Inmunología celular. Estirpes celulares. Marcadores específicos. Clasificación inmunológica de las poblaciones leucocitarias.`,
  56:`Histocompatibilidad. HLA: técnicas de identificación y tipificación. Trasplante de órganos y tejidos, criterios analíticos de selección. Complejo mayor de histocompatibilidad y enfermedad. Papel del laboratorio en el trasplante de órganos.`,
  57:`Estudio de las enfermedades alérgicas e hipersensibilidad. Fisiopatología y fundamentos de la respuesta alérgica. Mecanismos y tipos de reacciones de hipersensibilidad: IgE total e IgE especifica. Métodos de determinación. Informes de resultados. Aplicabilidad clínica. Anafilaxia. Intolerancias alimentarias. Pruebas inmunológicas y genéticas para el diagnóstico de la enfermedad celíaca.`,
  58:`Estudio de las enfermedades autoinmunes órgano específicas. Fisiopatología. Características clínicas y bioquímicas para el diagnóstico y seguimiento. Autoanticuerpos específicos de órganos: métodos de determinación, algoritmos diagnósticos y correlación clínico-patológica.`,
  59:`Estudio de las enfermedades autoinmunes sistémicas. Fisiopatología. Características clínicas y bioquímicas para el diagnóstico y seguimiento. Autoanticuerpos en enfermedades autoinmunes sistémicas: métodos de determinación, algoritmos diagnósticos y correlación clínico-patológica.`,
  60:`Inmunodeficiencias congénitas y adquiridas. Papel del laboratorio clínico en su estudio.`,
};
const getStatus=(topic,stats)=>{
  const s=stats[topic];
  if(!s||s.t<4) return 'sinEmpezar';
  const p=s.c/s.t*100;
  if(p<50) return 'necesitaTrabajo';
  if(p<75) return 'enProgreso';
  return 'dominado';
};
const STATUS_LABELS={sinEmpezar:'Sin empezar',necesitaTrabajo:'Necesita trabajo',enProgreso:'En progreso',dominado:'Dominado'};
const STATUS_COLORS={sinEmpezar:T.dim,necesitaTrabajo:T.red,enProgreso:T.amber,dominado:T.green};
const STATUS_BG={sinEmpezar:T.card,necesitaTrabajo:T.redS,enProgreso:T.amberS,dominado:T.greenS};
const STATUS_ORDER={sinEmpezar:0,necesitaTrabajo:1,enProgreso:2,dominado:3};

// ── Mastery levels ──────────────────────────────────────────────────────────
function getMasteryLevel(score){
  if(score==null||score<=20) return {name:'Sin explorar',color:T.dim,emoji:'⬜'};
  if(score<=40) return {name:'Iniciado',color:T.red,emoji:'🔴'};
  if(score<=60) return {name:'Aprendiz',color:T.orange,emoji:'🟠'};
  if(score<=75) return {name:'Competente',color:T.amber,emoji:'🟡'};
  if(score<=85) return {name:'Avanzado',color:T.teal,emoji:'🟢'};
  if(score<=95) return {name:'Experto',color:T.green,emoji:'💚'};
  return {name:'Maestro',color:T.green,emoji:'⭐'};
}

// ── Session scoring (0-100) ─────────────────────────────────────────────────
function calcSessionScore(gen,elapsed){
  const prog=gen.progress||{};const phases=gen.phases||{};
  let score=0;const breakdown={};

  // Posttest: 35%
  if(prog.postTest?.completed){const v=prog.postTest.score/100*35;score+=v;breakdown.postTest=Math.round(v);}
  // Flashcards SM-2: 25%
  const fcTotal=phases.flashcards?.length||0;
  if(fcTotal>0&&prog.flashcardsDominated!=null){const v=prog.flashcardsDominated/fcTotal*25;score+=v;breakdown.flashcards=Math.round(v);}
  // Clinical cases: 20%
  if(prog.clinicalScore!=null){const v=prog.clinicalScore/100*20;score+=v;breakdown.clinical=Math.round(v);}
  // Interactive questions: 15% — estimate from available phases
  let interCorrect=0,interTotal=0;
  if(prog.fillBlanks?.completed){interCorrect+=prog.fillBlanks.score;interTotal+=100;}
  if(prog.openQuestions?.completed){interCorrect+=prog.openQuestions.score;interTotal+=100;}
  if(interTotal>0){const v=interCorrect/interTotal*15;score+=v;breakdown.interactive=Math.round(v);}
  // Fill blanks: 5%
  if(prog.fillBlanks?.completed){const v=prog.fillBlanks.score/100*5;score+=v;breakdown.fillBlanks=Math.round(v);}

  // Modifiers
  const mods=[];
  // Blind spots: -2 per (max -10)
  const cert=prog.postTest?.certainty||{};
  const blindSpots=Object.entries(prog.postTest?.answers||{}).filter(([i,a])=>{
    const q=(phases.postTest||[])[parseInt(i)];
    return cert[i]==='seguro'&&q&&a!==q.correct;
  }).length;
  if(blindSpots>0){const pen=Math.min(blindSpots*2,10);score-=pen;mods.push({type:'blindspot',value:-pen,detail:`${blindSpots} puntos ciegos`});}
  // Bonus: pretest→posttest improvement >30
  if(prog.preTest?.completed&&prog.postTest?.completed&&prog.postTest.score-prog.preTest.score>30){score+=5;mods.push({type:'bonus',value:5,detail:'Mejora >30% pre→post'});}
  // Time penalty: >3× estimated (estimate ~20min per section)
  if(elapsed>3600){score-=5;mods.push({type:'time',value:-5,detail:'Sesión excesivamente larga'});}

  score=Math.max(0,Math.min(100,Math.round(score)));
  return{score,breakdown,mods};
}

// Review mastery update weights by type
const REVIEW_WEIGHTS={reconocimiento:{prev:0.6,review:0.4},consolidacion:{prev:0.5,review:0.5},integracion:{prev:0.4,review:0.6},profundo:{prev:0.3,review:0.7},mantenimiento:{prev:0.2,review:0.8}};
function updateMasteryAfterReview(prevMastery,reviewScore,reviewType){
  const w=REVIEW_WEIGHTS[reviewType]||{prev:0.5,review:0.5};
  return Math.round(prevMastery*w.prev+reviewScore*w.review);
}
// Streak data: {current, max, lastDate}
function loadStreak(){return load('olab_streak',{current:0,max:0,lastDate:null});}
function saveStreak(s){save('olab_streak',s);return s;}
// Difficulty calibration: track accuracy by question type
function loadDiffProfile(){return load('olab_diff_profile',{concepto:{c:0,t:0},mecanismo:{c:0,t:0},valor:{c:0,t:0},clinico:{c:0,t:0},aplicacion:{c:0,t:0}});}
function updateDiffProfile(tipo,correct){
  const p=loadDiffProfile();
  const key=tipo||'concepto';
  if(!p[key])p[key]={c:0,t:0};
  p[key]={c:p[key].c+(correct?1:0),t:p[key].t+1};
  save('olab_diff_profile',p);return p;
}
function getDiffCalibration(){
  const p=loadDiffProfile();
  const types=Object.entries(p).filter(([,v])=>v.t>=5);
  if(types.length<2)return''; // not enough data
  const accs=types.map(([k,v])=>({k,acc:Math.round(v.c/v.t*100)})).sort((a,b)=>a.acc-b.acc);
  const weak=accs.filter(a=>a.acc<70).map(a=>a.k);
  const strong=accs.filter(a=>a.acc>85).map(a=>a.k);
  if(!weak.length&&!strong.length)return'';
  let hint='\n\nCALIBRACIÓN DE DIFICULTAD basada en el perfil del estudiante:';
  if(weak.length)hint+=`\n- Generar MÁS preguntas de tipo: ${weak.join(', ')} (puntos débiles del estudiante)`;
  if(strong.length)hint+=`\n- Generar MENOS preguntas de tipo: ${strong.join(', ')} (ya dominados)`;
  return hint;
}
function updateStreak(){
  const s=loadStreak();
  const today=new Date().toISOString().slice(0,10);
  if(s.lastDate===today)return s; // already counted today
  const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);
  const yStr=yesterday.toISOString().slice(0,10);
  let current=s.lastDate===yStr?s.current+1:1;
  const max=Math.max(s.max||0,current);
  return saveStreak({current,max,lastDate:today});
}

// ── Learning status helpers ─────────────────────────────────────────────────
// Use stored mastery from latest session score, or calculate from progress
function calcUnitScore(unit){
  if(!unit?.generated) return null;
  const prog=unit.generated.progress||{};
  // If we have a computed session score stored, use it
  if(prog.mastery!=null) return prog.mastery;
  // Fallback: calculate from components
  const gen=unit.generated;
  const{score}=calcSessionScore(gen,0);
  return score>0?score:null;
}
// Score for a section: if it has subsections, weighted average of subsections; otherwise direct score
function calcSectionScore(sec){
  if(sec?.subsections?.length){
    const subScores=sec.subsections.map(calcUnitScore).filter(s=>s!==null);
    if(!subScores.length) return calcUnitScore(sec); // fallback to section's own score
    return Math.round(subScores.reduce((a,b)=>a+b,0)/subScores.length);
  }
  return calcUnitScore(sec);
}
// Global learning status for a topic: {coverage, mastery, status, color}
function getLearningStatus(learning){
  if(!learning?.sections||!learning.sections.length) return {coverage:0,mastery:0,status:'sinEmpezar',color:T.dim,label:'Sin empezar'};
  const total=learning.sections.length;
  const generated=learning.sections.filter(s=>s.generated||(s.subsections||[]).some(sub=>sub.generated)).length;
  // Word-weighted mastery: each section weighted by its content size
  let weightedSum=0,totalWeight=0;
  learning.sections.forEach(s=>{
    const score=calcSectionScore(s);
    if(score===null)return;
    const words=(s.text?.split(/\s+/).length||1000);
    weightedSum+=score*words;totalWeight+=words;
  });
  const mastery=totalWeight>0?Math.round(weightedSum/totalWeight):0;
  const coverage=Math.round(generated/total*100);
  const hasLowSection=learning.sections.some(s=>{const sc=calcSectionScore(s);return sc!==null&&sc<60;});
  const lvl=getMasteryLevel(mastery);
  let status,color,label;
  if(generated===0){status='sinEmpezar';color=T.dim;label='Sin empezar';}
  else if(hasLowSection){status='necesitaTrabajo';color=T.red;label=`${lvl.emoji} ${lvl.name} · ${mastery}%`;}
  else if(mastery>=80&&coverage===100){status='dominado';color=T.green;label=`${lvl.emoji} ${lvl.name} · ${mastery}%`;}
  else{status='enProgreso';color=T.amber;label=`${lvl.emoji} ${lvl.name} · ${mastery}%`;}
  return{coverage,mastery,status,color,label,generated,total};
}

// ═══════════════════════════════════════════════════════════════════════════
export default function App(){
  const [tab,setTab]=useState('dashboard');
  const [darkMode,setDarkMode]=useState(()=>{const saved=load('olab_dark_mode',null);return saved!==null?saved:isNightTime();});
  // Apply theme
  T=darkMode?DARK:LIGHT;
  useEffect(()=>{document.body.style.background=T.bg;document.body.style.color=T.text;},[darkMode]);
  const [qs,setQs]=useState([]);
  const [sr,setSr]=useState({});
  const [stats,setStats]=useState({});
  const [marked,setMarked]=useState(new Set());
  const [errSet,setErrSet]=useState(new Set());
  const [sessions,setSessions]=useState([]);
  const [examDate,setExamDateState]=useState('');
  const [notes,setNotesState]=useState({});
  const [topicNotes,setTopicNotesState]=useState({});
  const [bankPreselect,setBankPreselect]=useState(null);
  const [studyPreselect,setStudyPreselect]=useState(null);
  const [pdfMeta,setPdfMetaState]=useState({});
  const [apiKey,setApiKeyState]=useState('');
  const [studyNotes,setStudyNotesState]=useState({});
  const [loaded,setLoaded]=useState(false);
  const [topicView,setTopicView]=useState(null);
  const [learningData,setLearningData]=useState({});
  const [reviewDismissed,setReviewDismissed]=useState(false);
  const [activeReview,setActiveReview]=useState(null);
  const [streakData,setStreakData]=useState({current:0,max:0,lastDate:null});
  // levelUpMsg removed — level shown in semaphore/metrics only
  // ── Background jobs system — generations survive tab switches ──────────────
  const [bgJobs,setBgJobs]=useState(()=>load('olab_bgjobs',{})); // {jobId: {type,topic,status,step,pct,error,result}}
  const bgJobsRef=useRef({});
  const updateJob=(id,update)=>{setBgJobs(prev=>{const n={...prev,[id]:{...prev[id],...update}};save('olab_bgjobs',n);return n;});};
  const clearJob=(id)=>{setBgJobs(prev=>{const n={...prev};delete n[id];save('olab_bgjobs',n);return n;});};
  const getActiveJobs=()=>Object.entries(bgJobs).filter(([,j])=>j.status==='running');
  // Expose job runner for child components
  const startBgJob=useCallback((id,type,topic,runFn)=>{
    updateJob(id,{type,topic,status:'running',step:'Iniciando...',pct:0,error:null,result:null,startedAt:Date.now()});
    // Run async work independently of component lifecycle
    const run=async()=>{
      try{
        await runFn(
          (step,pct)=>updateJob(id,{step,pct}), // progress callback
          (result)=>{updateJob(id,{status:'done',pct:100,step:'Completado',result});} // done callback
        );
      }catch(e){updateJob(id,{status:'error',error:e.message});}
    };
    run();
  },[]);

  useEffect(()=>{
    (async()=>{
      // Load everything synchronously from localStorage
      const s=load('olab_sr',{});
      const st=load('olab_stats',{});
      const mk=load('olab_mk',[]);
      const er=load('olab_er',[]);
      const sess=load('olab_sessions',[]);
      const ed=load('olab_exam_date','');
      const nt=load('olab_notes',{});
      const tn=load('olab_topic_notes',{});
      const pm=load('olab_pdf_meta',{});
      const ak=load('olab_api_key','');
      const sn=load('olab_study_notes',{});

      // Load questions from IndexedDB (no size limit)
      let q=await idbLoadAllQs();
      // Migrate from localStorage if IndexedDB is empty but localStorage has questions
      if(q.length===0){
        const legacyQs=load('olab_qs',[]);
        if(legacyQs.length>0){
          await Promise.all(legacyQs.map(qItem=>idbSaveQ(qItem)));
          localStorage.removeItem('olab_qs');
          q=legacyQs;
        }
      }

      // Load learning data from IndexedDB
      const ld=await idbLoadAllLearning();

      setQs(q);setSr(s);setStats(st);setMarked(new Set(mk));setErrSet(new Set(er));
      setSessions(sess);setExamDateState(ed);setNotesState(nt);setTopicNotesState(tn);setPdfMetaState(pm);
      setApiKeyState(ak);setStudyNotesState(sn);setLearningData(ld);setStreakData(loadStreak());
      // Mark interrupted bg jobs from previous session
      const savedJobs=load('olab_bgjobs',{});
      const fixedJobs={};
      Object.entries(savedJobs).forEach(([id,j])=>{
        if(j.status==='running') fixedJobs[id]={...j,status:'interrupted',error:'Sesión interrumpida. Puedes reintentar.'};
        else if(j.status==='done'||j.status==='error') fixedJobs[id]=j;
      });
      if(Object.keys(fixedJobs).length) setBgJobs(fixedJobs);
      setLoaded(true);
    })();
  },[]);

  const saveApiKey=useCallback(k=>{setApiKeyState(k);save('olab_api_key',k);},[]);
  const saveStudyNote=useCallback((topic,content)=>{
    setStudyNotesState(prev=>{const n={...prev,[topic]:{content,date:new Date().toISOString()}};save('olab_study_notes',n);return n;});
  },[]);
  const saveLearningData=useCallback(async(topic,data)=>{
    if(data){
      await idbSaveLearning(topic,data);
      // Check for level-up before updating state
      setLearningData(prev=>{
        const oldLd=prev[topic];
        const oldMastery=oldLd?getLearningStatus(oldLd).mastery:0;
        const newMastery=getLearningStatus(data).mastery;
        const oldLvl=getMasteryLevel(oldMastery);const newLvl=getMasteryLevel(newMastery);
        // Level change logged silently — shown in semaphore/metrics
        if(newLvl.name!==oldLvl.name&&newMastery>oldMastery)console.log(`[Level] ${topic.split('.')[0]}: ${oldLvl.name} → ${newLvl.name}`);
        return{...prev,[topic]:data};
      });
      setStreakData(updateStreak());
    }else{await idbDeleteLearning(topic);setLearningData(prev=>{const n={...prev};delete n[topic];return n;});}
  },[]);

  // saveQs — persiste en IndexedDB. Acepta el array completo nuevo.
  const saveQs=useCallback(async newQs=>{
    const prev=await idbLoadAllQs();
    const prevIds=new Set(prev.map(q=>q.id));
    const newIds=new Set(newQs.map(q=>q.id));
    // Guardar preguntas nuevas
    const toAdd=newQs.filter(q=>!prevIds.has(q.id));
    // Borrar preguntas eliminadas
    const toDelete=prev.filter(q=>!newIds.has(q.id));
    await Promise.all([
      ...toAdd.map(q=>idbSaveQ(q)),
      ...toDelete.map(q=>idbDelQ(q.id)),
    ]);
    setQs(newQs);
  },[]);
  const setExamDate=useCallback(d=>{setExamDateState(d);save('olab_exam_date',d);},[]);
  const setNote=useCallback((sid,text)=>{setNotesState(prev=>{const n={...prev,[sid]:text};save('olab_notes',n);return n;});},[]);
  const saveTopicNote=useCallback((topic,text)=>{setTopicNotesState(prev=>{const n={...prev,[topic]:text};save('olab_topic_notes',n);return n;});},[]);

  // Guardar PDF completo sin dividir
  const savePdfForTopic=useCallback(async(topic,file)=>{
    const tKey=topicPdfKey(topic);
    const fileId=uid();
    await idbSave(topicFilePdfKey(topic,fileId),file);
    // Get page count for metadata
    let pageCount='?';
    try{const buf=await file.arrayBuffer();const doc=await PDFDocument.load(buf,{ignoreEncryption:true});pageCount=`1–${doc.getPageCount()}`;}catch{}
    setPdfMetaState(prev=>{
      const existing=prev[tKey]||[];
      const entry={id:fileId,name:file.name,size:file.size,date:new Date().toISOString(),pages:pageCount};
      const n={...prev,[tKey]:[...existing,entry]};
      save('olab_pdf_meta',n);return n;
    });
    return 1;
  },[]);

  // Eliminar un PDF específico por su fileId
  const deletePdfForTopic=useCallback(async(topic,fileId)=>{
    await idbDel(topicFilePdfKey(topic,fileId));
    setPdfMetaState(prev=>{
      const tKey=topicPdfKey(topic);
      const filtered=(prev[tKey]||[]).filter(f=>f.id!==fileId);
      const n={...prev};
      if(filtered.length>0) n[tKey]=filtered; else delete n[tKey];
      save('olab_pdf_meta',n);return n;
    });
  },[]);

  const recordAnswer=useCallback(async(qid,topic,correct,quality,questionMeta)=>{
    // Update topic stats (feeds getStatus traffic light)
    setStats(prev=>{const ns={...prev};if(!ns[topic])ns[topic]={c:0,t:0};ns[topic]={c:ns[topic].c+(correct?1:0),t:ns[topic].t+1};save('olab_stats',ns);return ns;});
    setStreakData(updateStreak());
    // Update difficulty calibration profile
    if(questionMeta?.tipo) updateDiffProfile(questionMeta.tipo,correct);
    setSr(prev=>{const nsr={...prev,[qid]:sm2Update(prev[qid],quality)};save('olab_sr',nsr);return nsr;});
    setErrSet(prev=>{const ne=new Set(prev);correct?ne.delete(qid):ne.add(qid);save('olab_er',[...ne]);return ne;});
    // Cross-update learning mastery if question has section metadata
    if(questionMeta?.seccion){
      setLearningData(prev=>{
        const ld=prev[topic];if(!ld?.sections)return prev;
        const secIdx=ld.sections.findIndex(s=>s.title===questionMeta.seccion);
        if(secIdx<0)return prev;
        const sec=ld.sections[secIdx];if(!sec?.generated)return prev;
        // Update external test stats on the section
        const ext=sec.generated.progress?.externalTests||{c:0,t:0};
        const newExt={c:ext.c+(correct?1:0),t:ext.t+1};
        const newProg={...sec.generated.progress,externalTests:newExt};
        const updSections=ld.sections.map((s,i)=>i===secIdx?{...s,generated:{...s.generated,progress:newProg}}:s);
        const updated={...ld,sections:updSections};
        idbSaveLearning(topic,updated);
        return{...prev,[topic]:updated};
      });
    }
  },[]);

  const toggleMark=useCallback(async qid=>{
    setMarked(prev=>{const nm=new Set(prev);nm.has(qid)?nm.delete(qid):nm.add(qid);save('olab_mk',[...nm]);return nm;});
  },[]);

  const addSession=useCallback(async data=>{
    const prev=load('olab_sessions',[]);
    const updated=[{...data,date:new Date().toISOString(),id:uid()},...prev].slice(0,50);
    save('olab_sessions',updated);setSessions(updated);
  },[]);

  const goToBank=useCallback((section,topic)=>{setBankPreselect({section,topic});setTab('bank');},[]);

  if(!loaded) return(
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:T.bg,fontFamily:FONT}}>
      <div style={{textAlign:'center'}}>
        <div style={{width:48,height:48,borderRadius:12,background:`linear-gradient(135deg,${T.green},${T.teal})`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,margin:'0 auto 12px'}}>🔬</div>
        <div style={{color:T.muted,fontSize:14}}>Cargando OPE Lab...</div>
      </div>
    </div>
  );

  const testQs=qs.filter(q=>q.type==='test');
  const fcQs=qs.filter(q=>q.type==='flashcard');
  const dueQs=fcQs.filter(q=>isDue(sr[q.id]));
  const shared={qs,testQs,fcQs,dueQs,sr,stats,marked,errSet,recordAnswer,toggleMark,saveQs,setTab,addSession};

  // ── Review gate: check for pending reviews before showing main app ────────
  const todayKey='olab_review_'+new Date().toISOString().slice(0,10);
  const reviewAlreadyDone=reviewDismissed||load(todayKey,false);

  // Collect all pending reviews with their mastery scores
  const pendingReviews=[];
  if(!reviewAlreadyDone){
    const today=new Date().toISOString().slice(0,10);
    Object.entries(learningData||{}).forEach(([topicName,data])=>{
      if(!data?.spacedRepetition?.reviews)return;
      const reviews=Array.isArray(data.spacedRepetition.reviews)?data.spacedRepetition.reviews:
        Object.entries(data.spacedRepetition.reviews).map(([label,rev])=>({label,fechaProgramada:rev.date,completado:rev.completed,type:label,seccionId:null}));
      reviews.forEach(rev=>{
        if((rev.fechaProgramada||rev.date)<=today&&!rev.completado&&!rev.completed){
          const ls=getLearningStatus(data);
          // Find the section this review belongs to, or worst section
          const secIdx=rev.seccionId?(data.sections||[]).findIndex(s=>(s.id||s.title)===rev.seccionId):-1;
          const sectionScores=(data.sections||[]).map((s,i)=>({idx:i,title:s.title,score:calcSectionScore(s),sec:s})).filter(s=>s.score!==null);
          const targetSection=secIdx>=0?sectionScores.find(s=>s.idx===secIdx):sectionScores.sort((a,b)=>a.score-b.score)[0];
          const worstSection=targetSection||sectionScores[0]||null;
          pendingReviews.push({topic:topicName,label:rev.label||rev.type,date:rev.fechaProgramada||rev.date,mastery:ls.mastery,color:ls.color,status:ls.status,worstSection,data,reviewObj:rev});
        }
      });
    });
    pendingReviews.sort((a,b)=>{
      // Urgent (overdue >1 day) first, then today's, then by mastery
      const aOverdue=new Date(today)-new Date(a.date)>86400000;
      const bOverdue=new Date(today)-new Date(b.date)>86400000;
      if(aOverdue&&!bOverdue)return-1;if(!aOverdue&&bOverdue)return 1;
      return(a.mastery<60?0:a.mastery<80?1:2)-(b.mastery<60?0:b.mastery<80?1:2);
    });
  }
  const hasRedReviews=pendingReviews.some(r=>r.mastery<60);
  const hasPendingReviews=pendingReviews.length>0;

  // Mark review day as done
  const markReviewDone=()=>{save(todayKey,true);setReviewDismissed(true);setActiveReview(null);};

  // Build condensed review items for a topic
  const startReview=(reviewItem)=>{
    const{topic,worstSection,data,reviewObj}=reviewItem;
    if(!worstSection?.sec?.generated)return markReviewDone();
    const gen=worstSection.sec.generated;
    const reviewType=reviewObj?.type||'reconocimiento';
    const allSections=(data.sections||[]).filter(s=>s.generated);
    const items=buildReviewItems(gen,reviewType,allSections);
    // Tag items with topic/section info
    items.forEach(it=>{it.topic=topic;it.secIdx=worstSection.idx;});
    if(!items.length)return markReviewDone();
    setActiveReview({items,currentItem:0,topic,secIdx:worstSection.idx,reviewLabel:reviewItem.label,results:[]});
  };

  // ── Active review session ─────────────────────────────────────────────────
  if(activeReview&&activeReview.showDiary) return(
    <LearningDiary topic={activeReview.topic} onComplete={(diary)=>{
      // Save diary to localStorage
      const diaries=load('olab_diaries',[]);
      diaries.push({...diary,topic:activeReview.topic,date:new Date().toISOString()});
      save('olab_diaries',diaries.slice(-100));
      markReviewDone();
    }}/>
  );
  if(activeReview) return(
    <div style={{minHeight:'100vh',background:T.bg,color:T.text,fontFamily:FONT,fontSize:14}}>
      <div style={{maxWidth:700,margin:'0 auto',padding:'32px 24px'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
          <div>
            <div style={{fontSize:10,color:T.dim,fontWeight:700,textTransform:'uppercase',letterSpacing:1,marginBottom:4}}>Repaso del día · {activeReview.reviewLabel}</div>
            <div style={{fontSize:16,fontWeight:700,color:T.text}}>{activeReview.topic.split('.').slice(0,1).join('.')}.</div>
          </div>
          <div style={{fontSize:12,color:T.dim}}>Parte {activeReview.currentItem+1} de {activeReview.items.length}</div>
        </div>
        <PBar pct={(activeReview.currentItem/activeReview.items.length)*100} color={T.green} height={3}/>
        <div style={{marginTop:20}}>
          <ReviewPhase
            item={activeReview.items[activeReview.currentItem]}
            onComplete={(result)=>{
              const newResults=[...activeReview.results,result];
              const nextItem=activeReview.currentItem+1;
              if(nextItem>=activeReview.items.length){
                // Review complete — mark as done, recalculate mastery, schedule next if needed
                const ld=learningData[activeReview.topic];
                if(ld){
                  const updatedLd={...ld};
                  // Mark this review as completed (supports both old object and new array format)
                  const sr=updatedLd.spacedRepetition||{reviews:[]};
                  if(Array.isArray(sr.reviews)){
                    sr.reviews=sr.reviews.map(r=>r.label===activeReview.reviewLabel&&r.seccionId===(activeReview.reviewObj?.seccionId||null)?{...r,completado:true}:r);
                  }else if(sr.reviews?.[activeReview.reviewLabel]){
                    sr.reviews={...sr.reviews,[activeReview.reviewLabel]:{...sr.reviews[activeReview.reviewLabel],completed:true}};
                  }
                  updatedLd.spacedRepetition=sr;
                  // Update section mastery with weighted formula: new = old*0.7 + review*0.3
                  const secIdx=activeReview.secIdx;
                  if(secIdx!=null&&updatedLd.sections?.[secIdx]?.generated){
                    const sec=updatedLd.sections[secIdx];
                    const ext=sec.generated.progress?.externalTests||{c:0,t:0};
                    const totalCorrect=newResults.reduce((a,r)=>a+(r.correct||0),0);
                    const totalQ=newResults.reduce((a,r)=>a+(r.total||0),0);
                    if(totalQ>0){
                      const reviewScore=Math.round(totalCorrect/totalQ*100);
                      const newExt={c:ext.c+totalCorrect,t:ext.t+totalQ};
                      updatedLd.sections[secIdx]={...sec,generated:{...sec.generated,progress:{...sec.generated.progress,externalTests:newExt,lastReviewScore:reviewScore}}};
                    }
                  }
                  // For D+30 mantenimiento: if mastery >=85% schedule D+60, if <70% reschedule D+7
                  const reviewType=activeReview.reviewObj?.type;
                  if(reviewType==='mantenimiento'&&Array.isArray(sr.reviews)){
                    const mastery=getLearningStatus(updatedLd).mastery;
                    const addD=(d,n)=>{const r=new Date(d);r.setDate(r.getDate()+n);return r.toISOString().slice(0,10);};
                    if(mastery>=85){
                      sr.reviews.push({id:uid(),temaId:activeReview.topic,seccionId:activeReview.reviewObj?.seccionId,type:'mantenimiento',label:'D+60',fechaProgramada:addD(new Date(),60),completado:false,duration:30,desc:'Repaso de mantenimiento extendido'});
                    }else if(mastery<70){
                      sr.reviews.push({id:uid(),temaId:activeReview.topic,seccionId:activeReview.reviewObj?.seccionId,type:'integracion',label:'D+7 (refuerzo)',fechaProgramada:addD(new Date(),7),completado:false,duration:20,desc:'Repaso de refuerzo por dominio bajo'});
                    }
                  }
                  saveLearningData(activeReview.topic,updatedLd);
                }
                // Show learning diary before closing
                setActiveReview(prev=>({...prev,showDiary:true,results:newResults}));
                return;
              }else{
                setActiveReview(prev=>({...prev,currentItem:nextItem,results:newResults}));
              }
            }}
          />
        </div>
      </div>
    </div>
  );

  // ── Review gate screen ────────────────────────────────────────────────────
  if(hasPendingReviews&&!reviewAlreadyDone) return(
    <ReviewGateScreen
      pendingReviews={pendingReviews}
      hasRedReviews={hasRedReviews}
      onStartReview={startReview}
      onSkip={markReviewDone}
    />
  );

  const navItems=[
    {id:'panel',label:'Panel'},
    {id:'estudio',label:'Estudio'},
    {id:'test',label:'Test'},
  ];

  // Normalize legacy tab names
  const normalizedTab=
    tab==='dashboard'||tab==='stats'||tab==='planificador'?'panel':
    tab==='temario'||tab==='estudio'?'estudio':
    tab==='test'||tab==='simulacro'||tab==='flashcard'||tab==='practica'||tab==='banco'?'test':
    tab==='ajustes'?'ajustes':tab;

  // SetupScreen solo si no hay API key Y estamos en modo local (sin servidor)
  // En Vercel la key está en el servidor — no hace falta pedirla al usuario

  // Ajustes overlay
  if(normalizedTab==='ajustes') return(
    <div style={{minHeight:'100vh',background:T.bg,color:T.text,fontFamily:FONT,fontSize:14}}>
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,boxShadow:sh.sm}}>
        <div style={{maxWidth:1200,margin:'0 auto',padding:'14px 40px',display:'flex',alignItems:'center',gap:12}}>
          <button onClick={()=>setTab('panel')} style={{background:'none',border:'none',cursor:'pointer',color:T.muted,fontSize:13,fontFamily:FONT,display:'flex',alignItems:'center',gap:4}}>← Volver</button>
          <span style={{fontWeight:700,fontSize:15,color:T.text}}>⚙️ Ajustes</span>
        </div>
      </div>
      <div style={{padding:'32px 40px',maxWidth:900,margin:'0 auto'}}>
        <Ajustes apiKey={apiKey} onSave={saveApiKey}/>
      </div>
    </div>
  );

  return(
    <div style={{minHeight:'100vh',background:T.bg,color:T.text,fontFamily:FONT,fontSize:14}}>
      <div style={{background:'rgba(255,255,255,0.92)',backdropFilter:'blur(12px)',borderBottom:`1px solid ${T.border}`,boxShadow:sh.sm,position:'sticky',top:0,zIndex:50}}>
        <div style={{padding:'0 40px'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',paddingTop:14,paddingBottom:6}}>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:36,height:36,borderRadius:12,background:`linear-gradient(135deg,${T.green},${T.teal})`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>🔬</div>
              <div><span style={{fontWeight:700,fontSize:16,color:T.text,letterSpacing:'-0.3px'}}>OPE Lab</span><span style={{color:T.muted,fontSize:11,marginLeft:8,fontWeight:400}}>FEA Laboratorio Clínico · SESCAM 2025</span></div>
            </div>
            <div style={{display:'flex',gap:6,alignItems:'center'}}>
              <Chip color={T.blue} bg={T.blueS}>{qs.length} preg.</Chip>
              {dueQs.length>0&&<Chip color={T.amber} bg={T.amberS}>{dueQs.length} pendientes</Chip>}
              {errSet.size>0&&<Chip color={T.red} bg={T.redS}>{errSet.size} errores</Chip>}
              <button onClick={()=>{const next=!darkMode;setDarkMode(next);save('olab_dark_mode',next);}} title={darkMode?'Modo claro':'Modo oscuro'} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:'6px 10px',cursor:'pointer',color:T.muted,fontSize:14,lineHeight:1,boxShadow:sh.sm}}>{darkMode?'☀️':'🌙'}</button>
              <button onClick={()=>setTab('ajustes')} title="Ajustes" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:'6px 10px',cursor:'pointer',color:T.muted,fontSize:14,lineHeight:1,boxShadow:sh.sm}}>⚙️</button>
            </div>
          </div>
          <div style={{display:'flex',marginTop:4,gap:0}}>
            {navItems.map(n=>{
              const hasJobs=getActiveJobs().length>0&&n.id==='estudio';
              return(
                <button key={n.id} onClick={()=>setTab(n.id)} style={{padding:'9px 16px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:normalizedTab===n.id?700:500,color:normalizedTab===n.id?T.green:T.dim,borderBottom:`2px solid ${normalizedTab===n.id?T.green:'transparent'}`,whiteSpace:'nowrap',fontFamily:FONT,transition:'color 0.15s',letterSpacing:'0.3px',display:'flex',alignItems:'center',gap:4}}>
                  {n.label}
                  {hasJobs&&<span style={{width:6,height:6,borderRadius:'50%',background:T.green,animation:'pulse 1.5s infinite'}}/>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Background job notifications */}
      {Object.entries(bgJobs).filter(([,j])=>j.status==='done'||j.status==='error').map(([id,j])=>(
        <div key={id} style={{position:'fixed',bottom:20,right:20,zIndex:200,background:j.status==='done'?T.greenS:T.redS,border:`0.5px solid ${j.status==='done'?T.green:T.red}`,borderRadius:10,padding:'12px 18px',maxWidth:320,cursor:'pointer'}} onClick={()=>clearJob(id)}>
          <div style={{fontSize:12,fontWeight:700,color:j.status==='done'?T.green:T.red}}>{j.status==='done'?'✅ Completado':'❌ Error'}</div>
          <div style={{fontSize:11,color:T.muted,marginTop:2}}>{j.type} · {j.topic?.split('.')[0]}</div>
          {j.error&&<div style={{fontSize:10,color:T.red,marginTop:2}}>{j.error}</div>}
          <div style={{fontSize:9,color:T.dim,marginTop:4}}>Toca para cerrar</div>
        </div>
      ))}

      <div style={{padding:'32px 40px',maxWidth:900,margin:'0 auto'}}>
        {topicView?(
          <TopicPage topic={topicView} onBack={()=>setTopicView(null)} stats={stats} qs={qs} pdfMeta={pdfMeta} savePdfForTopic={savePdfForTopic} deletePdfForTopic={deletePdfForTopic} apiKey={apiKey} learningData={learningData} saveLearningData={saveLearningData} sr={sr} recordAnswer={recordAnswer} goToBank={goToBank} setTab={setTab} saveQs={saveQs} bgJobs={bgJobs} startBgJob={startBgJob} clearJob={clearJob}/>
        ):(
          <>
            {normalizedTab==='panel'&&<Dashboard {...shared} examDate={examDate} sessions={sessions} learningData={learningData} setTopicView={setTopicView} setExamDate={setExamDate} streakData={streakData}/>}
            {normalizedTab==='estudio'&&<Temario setTab={setTab} stats={stats} qs={qs} notes={notes} setNote={setNote} pdfMeta={pdfMeta} savePdfForTopic={savePdfForTopic} deletePdfForTopic={deletePdfForTopic} apiKey={apiKey} setTopicView={setTopicView} learningData={learningData}/>}
            {normalizedTab==='test'&&<TestTab shared={shared} recordAnswer={recordAnswer} addSession={addSession} apiKey={apiKey} testQs={testQs} fcQs={fcQs} dueQs={dueQs} bankPreselect={bankPreselect} onBankPreselect={()=>setBankPreselect(null)} pdfMeta={pdfMeta} stats={stats} learningData={learningData} sessions={sessions}/>}
          </>
        )}
      </div>
    </div>
  );
}

// ── Primitives ───────────────────────────────────────────────────────────────
// ── Setup screen (first launch) ──────────────────────────────────────────────
function SetupScreen({onSave}){
  const [key,setKey]=useState('');
  const [err,setErr]=useState('');
  const save=()=>{
    if(!key.trim()){setErr('Introduce tu API key de Anthropic.');return;}
    if(!key.trim().startsWith('sk-ant-')){setErr('La clave debe empezar por sk-ant-...');return;}
    onSave(key.trim());
  };
  return(
    <div style={{minHeight:'100vh',background:T.bg,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:FONT,padding:24}}>
      <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:16,padding:'36px 32px',maxWidth:480,width:'100%',boxShadow:sh.md}}>
        <div style={{width:56,height:56,borderRadius:14,background:`linear-gradient(135deg,${T.blue},${T.teal})`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,marginBottom:20}}>🔬</div>
        <h1 style={{fontSize:22,fontWeight:700,margin:'0 0 8px',color:T.text,letterSpacing:-0.5}}>Bienvenido a OPE Lab</h1>
        <p style={{color:T.muted,fontSize:14,margin:'0 0 28px',lineHeight:1.6}}>Para generar preguntas con IA necesitas una API key de Anthropic. Es gratuito obtenerla y los costes son muy bajos (~0.003€ por generación).</p>
        <div style={{fontSize:12,color:T.muted,fontWeight:700,marginBottom:6,letterSpacing:0.5,textTransform:'uppercase'}}>API Key de Anthropic</div>
        <input value={key} onChange={e=>setKey(e.target.value)} onKeyDown={e=>e.key==='Enter'&&save()} type="password"
          placeholder="sk-ant-api03-..."
          style={{width:'100%',background:T.card,color:T.text,border:`1px solid ${err?T.red:T.border}`,borderRadius:8,padding:'10px 14px',fontSize:14,outline:'none',marginBottom:8,boxSizing:'border-box',fontFamily:'monospace'}}
        />
        {err&&<p style={{color:T.red,fontSize:12,margin:'0 0 12px'}}>{err}</p>}
        <p style={{color:T.dim,fontSize:11,margin:'0 0 20px',lineHeight:1.6}}>
          Obtén tu clave en <strong style={{color:T.blue}}>console.anthropic.com</strong> → API Keys → Create Key.<br/>
          Se guarda localmente en tu navegador. Nunca sale de tu dispositivo.
        </p>
        <button onClick={save} disabled={!key.trim()} style={{width:'100%',background:!key.trim()?T.card:T.blue,color:!key.trim()?T.dim:'#fff',border:'none',borderRadius:8,padding:'12px',fontWeight:700,fontSize:15,cursor:!key.trim()?'not-allowed':'pointer',fontFamily:FONT,boxShadow:sh.sm}}>
          Guardar y empezar →
        </button>
      </div>
    </div>
  );
}

// ── Ajustes ───────────────────────────────────────────────────────────────────
function Ajustes({apiKey,onSave}){
  const [key,setKey]=useState(apiKey);
  const [msg,setMsg]=useState('');
  const save=()=>{if(!key.trim()){setMsg('❌ Clave vacía.');return;}onSave(key.trim());setMsg('✅ API key guardada correctamente.');};
  const masked=apiKey?apiKey.slice(0,12)+'…'+apiKey.slice(-4):'—';
  return(
    <div style={{maxWidth:'100%'}}>
      <h2 style={{fontSize:18,fontWeight:700,margin:'0 0 24px',color:T.text,letterSpacing:-0.3}}>⚙️ Ajustes</h2>
      <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'20px 22px',marginBottom:16,boxShadow:sh.sm}}>
        <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:4}}>API Key de Anthropic</div>
        <div style={{fontSize:12,color:T.muted,marginBottom:14}}>Clave actual: <code style={{background:T.card,padding:'2px 6px',borderRadius:4,fontSize:11}}>{masked}</code></div>
        <input value={key} onChange={e=>setKey(e.target.value)} type="password" placeholder="sk-ant-api03-..."
          style={{width:'100%',background:T.card,color:T.text,border:`1px solid ${T.border}`,borderRadius:7,padding:'9px 12px',fontSize:13,outline:'none',marginBottom:12,boxSizing:'border-box',fontFamily:'monospace'}}
        />
        <button onClick={save} style={{background:T.blue,color:'#fff',border:'none',borderRadius:7,padding:'9px 20px',fontWeight:600,fontSize:13,cursor:'pointer',fontFamily:FONT,boxShadow:sh.sm}}>Guardar</button>
        {msg&&<span style={{marginLeft:12,fontSize:13,color:msg.startsWith('✅')?T.green:T.red}}>{msg}</span>}
      </div>
      <div style={{background:T.blueS,border:'1px solid #b0d0e0',borderRadius:10,padding:'14px 18px',fontSize:13,color:T.blueText,lineHeight:1.6}}>
        <strong>Privacidad:</strong> la API key se guarda únicamente en <code style={{fontSize:11,background:'#b0d0e0',padding:'1px 4px',borderRadius:3}}>localStorage</code> de tu navegador. No se envía a ningún servidor excepto a la API de Anthropic cuando generas preguntas.
      </div>
    </div>
  );
}

// ── LearningDiary — End-of-session reflection ───────────────────────────────
function LearningDiary({topic,onComplete}){
  const [step,setStep]=useState(0);
  const [answers,setAnswers]=useState({important:null,unclear:null,difficulty:null});

  const concepts=['Valores de referencia','Mecanismos fisiopatológicos','Criterios diagnósticos','Técnicas analíticas','Correlación clínico-patológica'];
  const unclearOpts=['Mecanismos complejos','Valores numéricos','Diagnóstico diferencial','Interferencias analíticas','Interpretación de resultados'];

  if(step===0) return(
    <div style={{minHeight:'100vh',background:T.bg,color:T.text,fontFamily:FONT,fontSize:14,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{maxWidth:480,padding:'0 24px',textAlign:'center'}}>
        <div style={{fontSize:28,marginBottom:12}}>📔</div>
        <h2 style={{fontSize:18,fontWeight:700,color:T.text,marginBottom:6}}>Diario de aprendizaje</h2>
        <div style={{fontSize:12,color:T.dim,marginBottom:20,lineHeight:1.6}}>3 preguntas rápidas para consolidar lo aprendido en {topic.split('.')[0]}.</div>
        <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:12}}>¿Qué es lo más importante que has aprendido hoy?</div>
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {concepts.map(c=>(
            <button key={c} onClick={()=>{setAnswers(a=>({...a,important:c}));setStep(1);}}
              style={{background:T.surface,border:`0.5px solid ${T.border}`,borderRadius:8,padding:'10px 14px',fontSize:12,cursor:'pointer',color:T.text,fontFamily:FONT,textAlign:'left'}}>{c}</button>
          ))}
        </div>
      </div>
    </div>
  );

  if(step===1) return(
    <div style={{minHeight:'100vh',background:T.bg,color:T.text,fontFamily:FONT,fontSize:14,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{maxWidth:480,padding:'0 24px',textAlign:'center'}}>
        <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:12}}>¿Qué concepto sigue sin estar claro?</div>
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {unclearOpts.map(c=>(
            <button key={c} onClick={()=>{setAnswers(a=>({...a,unclear:c}));setStep(2);}}
              style={{background:T.surface,border:`0.5px solid ${T.border}`,borderRadius:8,padding:'10px 14px',fontSize:12,cursor:'pointer',color:T.text,fontFamily:FONT,textAlign:'left'}}>{c}</button>
          ))}
          <button onClick={()=>{setAnswers(a=>({...a,unclear:'ninguno'}));setStep(2);}}
            style={{background:T.greenS,border:`0.5px solid ${T.green}`,borderRadius:8,padding:'10px 14px',fontSize:12,cursor:'pointer',color:T.green,fontFamily:FONT,fontWeight:600}}>Todo claro</button>
        </div>
      </div>
    </div>
  );

  if(step===2) return(
    <div style={{minHeight:'100vh',background:T.bg,color:T.text,fontFamily:FONT,fontSize:14,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{maxWidth:480,padding:'0 24px',textAlign:'center'}}>
        <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:12}}>¿Cómo de difícil ha sido esta sesión?</div>
        <div style={{display:'flex',gap:10,justifyContent:'center',marginBottom:20}}>
          {[1,2,3,4,5].map(n=>(
            <button key={n} onClick={()=>{setAnswers(a=>({...a,difficulty:n}));setStep(3);}}
              style={{width:48,height:48,borderRadius:'50%',background:answers.difficulty===n?T.amber:T.surface,border:`0.5px solid ${answers.difficulty===n?T.amber:T.border}`,fontSize:18,fontWeight:700,color:answers.difficulty===n?'#000':T.text,cursor:'pointer',fontFamily:FONT}}>{n}</button>
          ))}
        </div>
        <div style={{fontSize:10,color:T.dim}}>1 = Muy fácil · 5 = Muy difícil</div>
      </div>
    </div>
  );

  return(
    <div style={{minHeight:'100vh',background:T.bg,color:T.text,fontFamily:FONT,fontSize:14,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{maxWidth:480,padding:'0 24px',textAlign:'center'}}>
        <div style={{fontSize:40,marginBottom:12}}>✅</div>
        <h2 style={{fontSize:18,fontWeight:700,color:T.green,marginBottom:8}}>Sesión completada</h2>
        <div style={{fontSize:12,color:T.dim,marginBottom:20}}>Tu reflexión se ha guardado. {answers.unclear!=='ninguno'?`"${answers.unclear}" se añadirá a repasos prioritarios.`:''}</div>
        <button onClick={()=>onComplete(answers)} style={{background:T.green,color:'#fff',border:'none',borderRadius:8,padding:'12px 28px',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:FONT}}>Continuar</button>
      </div>
    </div>
  );
}

// ── ReviewGateScreen — Blocking review screen at startup ────────────────────
function ReviewGateScreen({pendingReviews,hasRedReviews,onStartReview,onSkip}){
  const [skipTimer,setSkipTimer]=useState(hasRedReviews?-1:10);
  useEffect(()=>{
    if(hasRedReviews||skipTimer<=0)return;
    const t=setTimeout(()=>setSkipTimer(s=>s-1),1000);
    return()=>clearTimeout(t);
  },[skipTimer,hasRedReviews]);

  return(
    <div style={{minHeight:'100vh',background:T.bg,color:T.text,fontFamily:FONT,fontSize:14,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{maxWidth:520,width:'100%',padding:'0 24px'}}>
        <div style={{textAlign:'center',marginBottom:32}}>
          <div style={{width:56,height:56,borderRadius:14,background:hasRedReviews?T.redS:T.surface,border:`0.5px solid ${hasRedReviews?T.red:T.border}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,margin:'0 auto 16px'}}>{hasRedReviews?'🚨':'📋'}</div>
          <h1 style={{fontSize:22,fontWeight:700,margin:'0 0 8px',color:T.text}}>Sesión de hoy</h1>
          <p style={{color:T.dim,margin:0,fontSize:13,lineHeight:1.6}}>
            {hasRedReviews
              ?'Tienes repasos urgentes. Completarlos ahora evitará que olvides lo que ya has aprendido.'
              :`${pendingReviews.length} repaso${pendingReviews.length>1?'s':''} pendiente${pendingReviews.length>1?'s':''}. Sesión rápida de 10-15 minutos.`}
          </p>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:24}}>
          {pendingReviews.map((r,i)=>{
            const urgencyColor=r.mastery<60?T.red:r.mastery<80?T.amber:T.green;
            return(
              <Card key={i} style={{padding:'14px 18px',borderLeft:`2px solid ${urgencyColor}`,cursor:'pointer'}} onClick={()=>onStartReview(r)}>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <span style={{width:10,height:10,borderRadius:'50%',background:urgencyColor,flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:T.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.topic}</div>
                    <div style={{fontSize:11,color:T.dim}}>{r.label} · {r.worstSection?r.worstSection.title:'—'}</div>
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{fontSize:16,fontWeight:700,color:urgencyColor}}>{r.mastery}%</div>
                    <div style={{fontSize:9,color:T.dim}}>{r.mastery<60?'Urgente':r.mastery<80?'Refuerzo':'Mantenimiento'}</div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:8,alignItems:'center'}}>
          <button onClick={()=>onStartReview(pendingReviews[0])}
            style={{width:'100%',background:T.green,color:'#fff',border:'none',borderRadius:8,padding:'14px',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:FONT}}>
            Empezar sesión
          </button>
          {!hasRedReviews&&(
            <button onClick={skipTimer<=0?onSkip:undefined} disabled={skipTimer>0}
              style={{background:'transparent',border:`0.5px solid ${T.border}`,borderRadius:8,padding:'10px 20px',fontSize:12,color:skipTimer>0?T.dim:T.muted,cursor:skipTimer>0?'not-allowed':'pointer',fontFamily:FONT}}>
              {skipTimer>0?`Saltar repasos (${skipTimer}s)`:'Saltar repasos'}
            </button>
          )}
          {hasRedReviews&&<div style={{fontSize:11,color:T.red,textAlign:'center',lineHeight:1.5,marginTop:4}}>No puedes saltar repasos con dominio en rojo.</div>}
        </div>
      </div>
    </div>
  );
}

// ── ReviewPhase — Condensed review experience ───────────────────────────────
function ReviewPhase({item,onComplete}){
  const [current,setCurrent]=useState(0);
  const [answers,setAnswers]=useState({});
  const [revealed,setRevealed]=useState({});
  const [flipped,setFlipped]=useState(false);
  const [fcKnown,setFcKnown]=useState(new Set());
  const [done,setDone]=useState(false);

  if(!item)return null;

  // Quiz type (post-test questions)
  if(item.type==='quiz'){
    const qs=item.questions;
    if(done){
      const correct=Object.entries(answers).filter(([i,a])=>a===qs[parseInt(i)]?.correct).length;
      const score=Math.round(correct/qs.length*100);
      return(
        <Card style={{padding:'24px',textAlign:'center'}}>
          <div style={{fontSize:40,marginBottom:12}}>{score>=70?'✅':'📚'}</div>
          <div style={{fontSize:22,fontWeight:700,color:score>=70?T.green:score>=50?T.amber:T.red}}>{score}%</div>
          <div style={{fontSize:13,color:T.text,marginBottom:4}}>{correct} de {qs.length} correctas</div>
          <div style={{fontSize:12,color:T.dim,marginBottom:16}}>{item.title}</div>
          <button onClick={()=>onComplete({quizScore:score,correct,total:qs.length})} style={{background:T.green,color:'#fff',border:'none',borderRadius:8,padding:'10px 24px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:FONT}}>Continuar</button>
        </Card>
      );
    }
    const q=qs[current];if(!q)return null;
    const isRevealed=revealed[current];
    return(
      <div>
        <div style={{fontSize:12,fontWeight:600,color:T.dim,marginBottom:8}}>{item.title} — {current+1}/{qs.length}</div>
        <Card style={{padding:'18px'}}>
          <div style={{fontSize:13,color:T.text,lineHeight:1.7,marginBottom:14,fontWeight:500}}>{q.question}</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {(q.options||[]).map((opt,j)=>{
              const isSel=answers[current]===j;const isOk=j===q.correct;
              let bg=T.card,bdr=T.border,col=T.text;
              if(isRevealed&&isOk){bg=T.greenS;bdr=T.green;col=T.greenText;}
              else if(isRevealed&&isSel&&!isOk){bg=T.redS;bdr=T.red;col=T.redText;}
              else if(isSel){bg=T.blueS;bdr=T.blue;col=T.blueText;}
              return <button key={j} onClick={()=>{if(!isRevealed){setAnswers(p=>({...p,[current]:j}));setRevealed(p=>({...p,[current]:true}));}}} disabled={isRevealed}
                style={{background:bg,border:`0.5px solid ${bdr}`,borderRadius:8,padding:'10px 12px',fontSize:12,textAlign:'left',cursor:isRevealed?'default':'pointer',color:col,fontFamily:FONT}}>{opt}</button>;
            })}
          </div>
          {isRevealed&&q.explanation&&<div style={{marginTop:10,padding:'8px 12px',background:T.blueS,borderRadius:8,fontSize:11,color:T.blueText,lineHeight:1.6,borderLeft:`2px solid ${T.blue}`}}>{q.explanation}</div>}
          <div style={{display:'flex',justifyContent:'flex-end',marginTop:14}}>
            {current<qs.length-1
              ?<button onClick={()=>{setCurrent(c=>c+1);}} style={{background:'transparent',border:`0.5px solid ${T.border}`,borderRadius:6,padding:'6px 16px',fontSize:12,cursor:'pointer',color:T.muted,fontFamily:FONT}}>Siguiente →</button>
              :Object.keys(answers).length>=qs.length&&<button onClick={()=>setDone(true)} style={{background:T.green,color:'#fff',border:'none',borderRadius:6,padding:'6px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:FONT}}>Ver resultado</button>
            }
          </div>
        </Card>
      </div>
    );
  }

  // Flashcard type
  if(item.type==='flashcards'){
    const cards=item.cards;
    if(current>=cards.length){
      return(
        <Card style={{padding:'24px',textAlign:'center'}}>
          <div style={{fontSize:40,marginBottom:12}}>🃏</div>
          <div style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:4}}>{fcKnown.size} de {cards.length} dominadas</div>
          <div style={{fontSize:12,color:T.dim,marginBottom:16}}>{item.title}</div>
          <button onClick={()=>onComplete({flashcardsReviewed:cards.length,dominated:fcKnown.size})} style={{background:T.green,color:'#fff',border:'none',borderRadius:8,padding:'10px 24px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:FONT}}>Continuar</button>
        </Card>
      );
    }
    const card=cards[current];
    return(
      <div>
        <div style={{fontSize:12,fontWeight:600,color:T.dim,marginBottom:8}}>{item.title} — {current+1}/{cards.length}</div>
        <div onClick={()=>setFlipped(!flipped)} style={{background:flipped?T.tealS:T.surface,border:`0.5px solid ${flipped?T.teal:T.border}`,borderRadius:12,padding:'36px 24px',cursor:'pointer',textAlign:'center',minHeight:140,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
          <div style={{fontSize:10,color:T.dim,marginBottom:8,fontWeight:600,textTransform:'uppercase',letterSpacing:0.5}}>{flipped?'Respuesta':'Pregunta'}</div>
          <div style={{fontSize:14,color:flipped?T.tealText:T.text,fontWeight:600,lineHeight:1.6,maxWidth:450}}>{flipped?(card.back||'—'):(card.front||'—')}</div>
        </div>
        <div style={{display:'flex',justifyContent:'center',gap:8,marginTop:14}}>
          <button onClick={()=>{setFcKnown(p=>{const n=new Set(p);n.add(current);return n;});setCurrent(c=>c+1);setFlipped(false);}} style={{background:T.greenS,border:`0.5px solid ${T.green}`,borderRadius:8,padding:'8px 18px',fontSize:12,cursor:'pointer',color:T.greenText,fontWeight:600,fontFamily:FONT}}>✓ La sé</button>
          <button onClick={()=>{setCurrent(c=>c+1);setFlipped(false);}} style={{background:T.redS,border:`0.5px solid ${T.red}`,borderRadius:8,padding:'8px 18px',fontSize:12,cursor:'pointer',color:T.redText,fontWeight:600,fontFamily:FONT}}>✗ Repasar</button>
        </div>
      </div>
    );
  }

  // Clinical case type
  if(item.type==='clinical'){
    const c=item.cases[0];if(!c)return null;
    const isRev=revealed[0];
    if(done){
      const correct=answers[0]===c.correct;
      return(
        <Card style={{padding:'24px',textAlign:'center'}}>
          <div style={{fontSize:40,marginBottom:12}}>{correct?'✅':'📚'}</div>
          <div style={{fontSize:16,fontWeight:700,color:correct?T.green:T.red,marginBottom:16}}>{correct?'Correcto':'Incorrecto'}</div>
          {c.discussion&&<div style={{fontSize:12,color:T.muted,lineHeight:1.6,marginBottom:16,textAlign:'left',background:T.surface,borderRadius:8,padding:'12px',border:`0.5px solid ${T.border}`}}>{c.discussion}</div>}
          <button onClick={()=>onComplete({clinicalCorrect:correct?1:0,total:1,correct:correct?1:0})} style={{background:T.green,color:'#fff',border:'none',borderRadius:8,padding:'10px 24px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:FONT}}>Continuar</button>
        </Card>
      );
    }
    return(
      <div>
        <div style={{fontSize:12,fontWeight:600,color:T.dim,marginBottom:8}}>{item.title}</div>
        <Card style={{padding:'18px',borderLeft:`2px solid ${T.orange}`}}>
          <div style={{fontSize:10,fontWeight:700,color:T.orange,marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Caso clínico</div>
          <div style={{fontSize:13,color:T.text,lineHeight:1.8,marginBottom:14}}>{c.presentation}</div>
          <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:10}}>{c.question}</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {(c.options||[]).map((opt,j)=>{
              const isSel=answers[0]===j;const isOk=j===c.correct;
              let bg=T.card,bdr=T.border,col=T.text;
              if(isRev&&isOk){bg=T.greenS;bdr=T.green;col=T.greenText;}
              else if(isRev&&isSel&&!isOk){bg=T.redS;bdr=T.red;col=T.redText;}
              else if(isSel){bg=T.orangeS;bdr=T.orange;col=T.orangeText;}
              return <button key={j} onClick={()=>{if(!isRev){setAnswers({0:j});setRevealed({0:true});}}} disabled={isRev}
                style={{background:bg,border:`0.5px solid ${bdr}`,borderRadius:8,padding:'10px 12px',fontSize:12,textAlign:'left',cursor:isRev?'default':'pointer',color:col,fontFamily:FONT}}>{opt}</button>;
            })}
          </div>
          {isRev&&<div style={{display:'flex',justifyContent:'flex-end',marginTop:12}}><button onClick={()=>setDone(true)} style={{background:T.green,color:'#fff',border:'none',borderRadius:6,padding:'6px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:FONT}}>Ver resultado</button></div>}
        </Card>
      </div>
    );
  }

  return null;
}

// ── TestTab — Test OPE + Simulacro + Flashcards + Preguntas ─────────────────
function TestTab({shared,recordAnswer,addSession,apiKey,testQs,fcQs,dueQs,bankPreselect,onBankPreselect,pdfMeta,stats,learningData,sessions}){
  const [subTab,setSubTab]=useState('test');
  return(
    <div>
      <div style={{display:'flex',borderBottom:`1px solid ${T.border}`,marginBottom:22,gap:0}}>
        <button onClick={()=>setSubTab('test')} style={{padding:'8px 14px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:subTab==='test'?600:400,color:subTab==='test'?T.blue:T.muted,borderBottom:`2px solid ${subTab==='test'?T.blue:'transparent'}`,fontFamily:FONT}}>🧪 Test OPE</button>
        <button onClick={()=>setSubTab('simulacro')} style={{padding:'8px 14px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:subTab==='simulacro'?600:400,color:subTab==='simulacro'?T.orange:T.muted,borderBottom:`2px solid ${subTab==='simulacro'?T.orange:'transparent'}`,fontFamily:FONT}}>⚡ Simulacro</button>
        <button onClick={()=>setSubTab('flashcard')} style={{padding:'8px 14px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:subTab==='flashcard'?600:400,color:subTab==='flashcard'?T.teal:T.muted,borderBottom:`2px solid ${subTab==='flashcard'?T.teal:'transparent'}`,fontFamily:FONT}}>
          🃏 Flashcards {dueQs.length>0&&<span style={{fontSize:10,background:T.amberS,color:T.amber,padding:'1px 6px',borderRadius:10,marginLeft:4,fontWeight:700}}>{dueQs.length}</span>}
        </button>
        <button onClick={()=>setSubTab('preguntas')} style={{padding:'8px 14px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:subTab==='preguntas'?600:400,color:subTab==='preguntas'?T.purple:T.muted,borderBottom:`2px solid ${subTab==='preguntas'?T.purple:'transparent'}`,fontFamily:FONT}}>📦 Preguntas</button>
      </div>
      {subTab==='test'      &&<TestMode {...shared}/>}
      {subTab==='simulacro' &&<Simulacro testQs={testQs} recordAnswer={recordAnswer} addSession={addSession} sessions={sessions}/>}
      {subTab==='flashcard' &&<FlashcardMode {...shared}/>}
      {subTab==='preguntas' &&<BankManager {...shared} preselect={bankPreselect} onPreselect={onBankPreselect} pdfMeta={pdfMeta} apiKey={apiKey}/>}
    </div>
  );
}

// ── PdfViewer ─────────────────────────────────────────────────────────────────
function PdfViewer({topic,fileId,name,onClose}){
  const [url,setUrl]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(null);

  useEffect(()=>{
    let objectUrl=null;
    (async()=>{
      try{
        const blob=await idbLoad(topicFilePdfKey(topic,fileId));
        if(!blob){setError('No se encontró el PDF en el almacenamiento local.');setLoading(false);return;}
        objectUrl=URL.createObjectURL(blob instanceof File?blob:new File([blob],name,{type:'application/pdf'}));
        setUrl(objectUrl);
      }catch(e){setError(e.message);}
      setLoading(false);
    })();
    return()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[topic,fileId]);

  return(
    <div style={{marginTop:10,marginLeft:17,borderRadius:12,border:`1px solid ${T.border}`,overflow:'hidden',boxShadow:sh.md,background:T.surface}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',background:T.greenS,borderBottom:`1px solid ${T.border}`}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:15}}>📄</span>
          <div>
            <div style={{fontSize:12,fontWeight:700,color:T.greenText}}>{name}</div>
            <div style={{fontSize:10,color:T.muted}}>{topic.split('.')[0]} · Visor PDF</div>
          </div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {url&&<a href={url} download={name} style={{fontSize:11,color:T.green,fontWeight:600,textDecoration:'none',background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,padding:'3px 10px'}}>⬇ Descargar</a>}
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:T.dim,fontSize:18,padding:'0 4px',lineHeight:1}}>×</button>
        </div>
      </div>
      {/* Viewer */}
      <div style={{height:700,background:T.card}}>
        {loading&&(
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:T.muted,fontSize:13}}>
            <span>⏳ Cargando PDF...</span>
          </div>
        )}
        {error&&(
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:T.red,fontSize:13}}>
            ❌ {error}
          </div>
        )}
        {url&&!loading&&(
          <iframe
            src={url}
            title={name}
            style={{width:'100%',height:'100%',border:'none'}}
          />
        )}
      </div>
    </div>
  );
}


// ── Primitives ────────────────────────────────────────────────────────────────
function Chip({color,bg,children}){return <span style={{background:bg,color,padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:600}}>{children}</span>;}
function Lbl({children}){return <div style={{fontSize:11,color:T.muted,fontWeight:700,marginBottom:6,letterSpacing:0.5,textTransform:'uppercase'}}>{children}</div>;}
function Btn({onClick,disabled,children,variant='primary',style:st}){
  const v={primary:{bg:T.blue,c:'#fff'},green:{bg:T.green,c:'#fff'},ghost:{bg:'transparent',c:T.text},danger:{bg:T.redS,c:T.red},teal:{bg:T.teal,c:'#fff'},purple:{bg:T.purple,c:'#fff'},orange:{bg:T.orange,c:'#fff'}}[variant];
  return <button onClick={onClick} disabled={disabled} style={{background:disabled?T.bg:v.bg,color:disabled?T.dim:v.c,border:`1px solid ${disabled?T.border:v.bg}`,borderRadius:10,padding:'11px 24px',fontWeight:700,fontSize:14,cursor:disabled?'not-allowed':'pointer',fontFamily:FONT,letterSpacing:'0.1px',boxShadow:disabled?'none':sh.sm,transition:'all 250ms ease-in-out',...st}}>{children}</button>;
}
function RadioGroup({options,value,onChange}){
  return <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:16}}>
    {options.map(o=><label key={String(o.value)} style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer',padding:'8px 12px',borderRadius:7,background:value===o.value?T.blueS:'transparent',border:`1px solid ${value===o.value?T.blue:T.border}`,transition:'all 0.15s'}}>
      <input type="radio" checked={value===o.value} onChange={()=>onChange(o.value)} style={{accentColor:T.blue}}/>
      <span style={{fontSize:13,color:value===o.value?T.blue:T.text,fontWeight:value===o.value?600:400}}>{o.label}</span>
    </label>)}
  </div>;
}
function PBar({pct,color,height=6}){const c=color||(pct>=70?T.green:pct>=50?T.amber:T.red);return <div style={{background:T.border,borderRadius:6,height,overflow:'hidden'}}><div style={{background:c,width:`${Math.min(pct,100)}%`,height:'100%',borderRadius:6,transition:'width 0.6s ease-in-out'}}/></div>;}
function Card({children,style:st,...rest}){return <div style={{background:T.surface,borderRadius:12,border:`1px solid ${T.border}`,boxShadow:sh.sm,transition:'background 250ms ease-in-out, border-color 250ms ease-in-out',...st}} {...rest}>{children}</div>;}
function Sel({value,onChange,children,style:st}){return <select value={value} onChange={e=>onChange(e.target.value)} style={{width:'100%',background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:7,padding:'9px 12px',fontSize:13,outline:'none',marginBottom:14,fontFamily:FONT,boxShadow:sh.sm,...st}}>{children}</select>;}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════
function Dashboard({qs,testQs,fcQs,dueQs,stats,errSet,marked,setTab,examDate,sessions,learningData,setTopicView,setExamDate,streakData}){
  const totalA=Object.values(stats).reduce((a,b)=>a+b.t,0);
  const totalC=Object.values(stats).reduce((a,b)=>a+b.c,0);
  const acc=totalA?Math.round(totalC/totalA*100):0;
  const studied=ALL_TOPICS.filter(t=>stats[t]?.t>0).length;
  const dominated=ALL_TOPICS.filter(t=>getStatus(t,stats)==='dominado').length;
  const daysLeft=examDate?Math.max(0,Math.ceil((new Date(examDate).setHours(23,59,59)-Date.now())/86400000)):null;
  const streak=streakData?.current||0;
  const streakMax=streakData?.max||0;
  const streakHito=streak>=100?'🏆 100 días':streak>=30?'🔥 30 días':streak>=7?'⭐ 7 días':null;
  const allLS=Object.values(learningData||{}).map(getLearningStatus).filter(ls=>ls.status!=='sinEmpezar');
  const globalMastery=allLS.length?Math.round(allLS.reduce((a,ls)=>a+ls.mastery,0)/allLS.length):0;
  // % of topics with mastery >75% over total temario
  const topicsAbove75=Object.values(learningData||{}).filter(d=>getLearningStatus(d).mastery>75).length;
  const globalDominio=ALL_TOPICS.length?Math.round(topicsAbove75/ALL_TOPICS.length*100):0;
  // Find best topic
  const bestTopic=allLS.length?Object.entries(learningData||{}).map(([t,d])=>({t,m:getLearningStatus(d).mastery})).filter(x=>x.m>0).sort((a,b)=>b.m-a.m)[0]:null;

  return(
    <div>
      {/* Header + streak */}
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12}}>
          <div>
            <h1 style={{fontSize:24,fontWeight:700,margin:'0 0 4px',color:T.text,letterSpacing:-0.5}}>Sesión de estudio</h1>
            <p style={{color:T.dim,margin:0,fontSize:13}}>{new Date().toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'})} · {totalA>0?`${totalA} preg. · ${acc}% aciertos`:'Empieza tu primera sesión'}</p>
          </div>
          <div style={{display:'flex',gap:10,alignItems:'center'}}>
            {/* Streak — highlighted */}
            <div style={{background:streak>0?T.surface:T.bg,border:`0.5px solid ${streak>0?T.green+'40':T.border}`,borderRadius:12,padding:'12px 20px',textAlign:'center',minWidth:80}}>
              <div style={{fontSize:32,fontWeight:700,color:streak>0?T.green:T.dim,lineHeight:1}}>🔥 {streak}</div>
              <div style={{fontSize:10,color:T.dim,marginTop:3}}>{streak===1?'día racha':'días racha'}</div>
              {streakHito&&<div style={{fontSize:9,color:T.amber,fontWeight:700,marginTop:2}}>{streakHito}</div>}
            </div>
            {daysLeft!==null&&<div style={{background:T.surface,border:`0.5px solid ${T.border}`,borderRadius:12,padding:'12px 18px',textAlign:'center'}}><div style={{fontSize:28,fontWeight:700,color:daysLeft<30?T.red:daysLeft<90?T.amber:T.blue,lineHeight:1}}>{daysLeft}</div><div style={{fontSize:10,color:T.dim,marginTop:2}}>días OPE</div></div>}
          </div>
        </div>
      </div>

      {/* 3 key metrics */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:20}}>
        <Card style={{padding:'16px',textAlign:'center'}}>
          <div style={{fontSize:28,fontWeight:700,color:T.green,lineHeight:1}}>{dominated}</div>
          <div style={{fontSize:11,color:T.dim,marginTop:4}}>Temas dominados</div>
          <div style={{marginTop:6}}><PBar pct={dominated/ALL_TOPICS.length*100} color={T.green} height={3}/></div>
        </Card>
        <Card style={{padding:'16px',textAlign:'center'}}>
          <div style={{fontSize:28,fontWeight:700,color:dueQs.length>0?T.amber:T.dim,lineHeight:1}}>{dueQs.length}</div>
          <div style={{fontSize:11,color:T.dim,marginTop:4}}>Repasos hoy</div>
        </Card>
        <Card style={{padding:'16px',textAlign:'center'}}>
          <div style={{fontSize:28,fontWeight:700,color:globalMastery>=70?T.green:globalMastery>=40?T.amber:T.dim,lineHeight:1}}>{globalMastery}%</div>
          <div style={{fontSize:11,color:T.dim,marginTop:4}}>Dominio global</div>
          <div style={{fontSize:9,color:getMasteryLevel(globalMastery).color,fontWeight:700,marginTop:2}}>{getMasteryLevel(globalMastery).emoji} {getMasteryLevel(globalMastery).name}</div>
        </Card>
      </div>

      {/* Quick actions */}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:20}}>
        <Btn onClick={()=>setTab('simulacro')} variant="orange">⚡ Simulacro</Btn>
        <Btn onClick={()=>setTab('test')} disabled={testQs.length===0}>🧪 Test</Btn>
        <Btn onClick={()=>setTab('flashcard')} disabled={dueQs.length===0} variant="teal">🃏 Repasar {dueQs.length>0?`(${dueQs.length})`:''}</Btn>
      </div>

      {/* Stats section */}
      <Card style={{padding:'16px 20px',marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:700,color:T.text,marginBottom:10}}>📊 Estadísticas</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))',gap:8}}>
          {[
            {l:'Racha actual',v:streak,c:T.green,u:'días'},
            {l:'Racha máxima',v:streakMax,c:T.amber,u:'días'},
            {l:'Preguntas',v:totalA,c:T.blue,u:'respondidas'},
            {l:'Sesiones',v:sessions.length,c:T.teal,u:'completadas'},
            {l:'Temas vistos',v:`${studied}/60`,c:T.purple,u:''},
            {l:'Mejor tema',v:bestTopic?bestTopic.m+'%':'—',c:T.green,u:bestTopic?bestTopic.t.split('.')[0]+'.':''},
            {l:'Tiempo total',v:(()=>{let total=0;Object.keys(localStorage).filter(k=>k.startsWith('study_time_')).forEach(k=>{try{const arr=JSON.parse(localStorage.getItem(k));if(Array.isArray(arr))total+=arr.reduce((a,s)=>a+(s.seconds||0),0);}catch{}});return total>=3600?Math.round(total/3600)+'h':Math.round(total/60)+'min';})(),c:T.teal,u:'estudiado'},
          ].map(s=>(
            <div key={s.l} style={{padding:'8px',borderRadius:8,background:T.bg,border:`0.5px solid ${T.border}`}}>
              <div style={{fontSize:18,fontWeight:700,color:s.c,lineHeight:1}}>{s.v}</div>
              <div style={{fontSize:10,color:T.dim,marginTop:2}}>{s.l}</div>
              {s.u&&<div style={{fontSize:9,color:T.dim}}>{s.u}</div>}
            </div>
          ))}
        </div>
      </Card>

      {/* Repasos urgentes */}
      {(()=>{
        const today=new Date().toISOString().slice(0,10);
        const pending=[];
        const learningTopics=[];
        Object.entries(learningData||{}).forEach(([topic,data])=>{
          if(!data)return;
          if(data.spacedRepetition?.reviews){
            Object.entries(data.spacedRepetition.reviews).forEach(([label,rev])=>{
              if(rev.date<=today&&!rev.completed)pending.push({topic,label,date:rev.date});
            });
          }
          const ls=getLearningStatus(data);
          if(ls.status!=='sinEmpezar') learningTopics.push({topic,ls});
        });
        return(
          <>
          {pending.length>0&&(
            <Card style={{padding:'16px 20px',marginBottom:16,borderLeft:`2px solid ${T.red}`}}>
              <div style={{fontSize:13,fontWeight:700,color:T.red,marginBottom:10}}>Repasos urgentes</div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {pending.map((p,i)=>(
                  <div key={i} onClick={()=>setTopicView&&setTopicView(p.topic)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',background:T.redS,borderRadius:8,border:`0.5px solid ${T.border}`,cursor:'pointer'}}>
                    <span style={{fontSize:10,color:T.red,fontWeight:700,flexShrink:0}}>{p.label}</span>
                    <span style={{fontSize:12,color:T.text,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.topic}</span>
                    <span style={{fontSize:11,color:T.red,fontWeight:600}}>→</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {/* Continuar estudiando */}
          {learningTopics.length>0&&(
            <Card style={{padding:'16px 20px',marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:700,color:T.text,marginBottom:10}}>Continuar estudiando</div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {learningTopics.sort((a,b)=>a.ls.mastery-b.ls.mastery).map(({topic:tp,ls},i)=>(
                  <div key={i} onClick={()=>setTopicView&&setTopicView(tp)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderRadius:8,cursor:'pointer',border:`0.5px solid ${T.border}`,background:T.card}}>
                    <span style={{width:8,height:8,borderRadius:'50%',background:ls.color,flexShrink:0}}/>
                    <span style={{fontSize:12,color:T.text,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tp}</span>
                    <div style={{width:60}}><PBar pct={ls.mastery} color={ls.color} height={3}/></div>
                    <span style={{fontSize:11,fontWeight:700,color:ls.color,minWidth:30,textAlign:'right'}}>{ls.mastery}%</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          </>
        );
      })()}
      {sessions.length>0&&(
        <Card style={{padding:'18px 22px',marginBottom:20}}>
          <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:12,display:'flex',alignItems:'center',gap:8}}><span style={{width:3,height:16,background:T.blue,borderRadius:2,display:'block'}}/>Últimas sesiones</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {sessions.slice(0,5).map(s=>{
              const modeLabel={test:'Test OPE',simulacro:'Simulacro',flashcard:'Flashcards'}[s.mode]||s.mode;
              const modeColor={test:T.blue,simulacro:T.orange,flashcard:T.teal}[s.mode]||T.muted;
              return <div key={s.id} style={{display:'flex',alignItems:'center',gap:10,padding:'6px 0',borderBottom:`1px solid ${T.border}`}}>
                <span style={{background:modeColor+'20',color:modeColor,padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:600,flexShrink:0}}>{modeLabel}</span>
                <span style={{fontSize:12,color:T.muted,flex:1}}>{s.topics?.slice(0,2).join(', ').substring(0,50)}{s.topics?.length>2?'…':''}</span>
                <span style={{fontSize:12,fontWeight:600,color:s.pct>=70?T.green:s.pct>=50?T.amber:T.red,flexShrink:0}}>{s.pct}%</span>
                <span style={{fontSize:11,color:T.dim,flexShrink:0}}>{fmtDate(s.date)}</span>
              </div>;
            })}
          </div>
        </Card>
      )}

      {Object.keys(stats).length>0&&(
        <Card style={{padding:'18px 22px',marginBottom:20}}>
          <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:14,display:'flex',alignItems:'center',gap:8}}><span style={{width:3,height:16,background:T.teal,borderRadius:2,display:'block'}}/>Rendimiento por tema</div>
          {Object.entries(stats).sort((a,b)=>b[1].t-a[1].t).slice(0,5).map(([topic,s])=>{
            const pct=Math.round(s.c/s.t*100);
            return <div key={topic} style={{marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                <span style={{fontSize:12,color:T.text}}>{topic}</span>
                <span style={{fontSize:12,fontWeight:600,color:pct>=70?T.green:pct>=50?T.amber:T.red}}>{pct}% ({s.c}/{s.t})</span>
              </div>
              <PBar pct={pct}/>
            </div>;
          })}
        </Card>
      )}

      {/* Diagnóstico de conocimiento */}
      {(()=>{
        const diffProfile=loadDiffProfile();
        const typeAnalysis=Object.entries(diffProfile).filter(([,v])=>v.t>=3).map(([k,v])=>({type:k,acc:Math.round(v.c/v.t*100),total:v.t})).sort((a,b)=>a.acc-b.acc);
        // Section-level error rates from learning data
        const sectionErrors=[];
        Object.entries(learningData||{}).forEach(([t,ld])=>{
          (ld?.sections||[]).forEach(sec=>{
            const prog=sec?.generated?.progress;
            if(!prog)return;
            const scores=[];
            if(prog.preTest?.completed)scores.push(prog.preTest.score);
            if(prog.postTest?.completed)scores.push(prog.postTest.score);
            if(scores.length){const avg=Math.round(scores.reduce((a,b)=>a+b,0)/scores.length);sectionErrors.push({topic:t.split('.')[0],section:sec.title,score:avg,topicFull:t});}
          });
        });
        sectionErrors.sort((a,b)=>a.score-b.score);
        // Blind spots: high confidence + fail (sections scored >60 on pretest but <50 on posttest)
        const blindSpots=[];
        Object.entries(learningData||{}).forEach(([t,ld])=>{
          (ld?.sections||[]).forEach(sec=>{
            const prog=sec?.generated?.progress;
            if(prog?.preTest?.completed&&prog?.postTest?.completed&&prog.preTest.score>60&&prog.postTest.score<50){
              blindSpots.push({topic:t.split('.')[0],section:sec.title,pre:prog.preTest.score,post:prog.postTest.score,topicFull:t});
            }
          });
        });
        if(!typeAnalysis.length&&!sectionErrors.length)return null;
        return(
          <Card style={{padding:'18px 22px',marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:12,display:'flex',alignItems:'center',gap:8}}><span style={{width:3,height:16,background:T.red,borderRadius:2,display:'block'}}/>🔍 Diagnóstico de conocimiento</div>
            {/* Type weakness */}
            {typeAnalysis.length>0&&(
              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,color:T.muted,marginBottom:6}}>Rendimiento por tipo de pregunta</div>
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  {typeAnalysis.map(a=>(
                    <div key={a.type} style={{background:a.acc<50?T.redS:a.acc<70?T.amberS:T.greenS,border:`0.5px solid ${a.acc<50?T.red:a.acc<70?T.amber:T.green}`,borderRadius:8,padding:'6px 10px',textAlign:'center',minWidth:70}}>
                      <div style={{fontSize:14,fontWeight:700,color:a.acc<50?T.red:a.acc<70?T.amber:T.green}}>{a.acc}%</div>
                      <div style={{fontSize:9,color:T.dim}}>{a.type} ({a.total})</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Worst sections */}
            {sectionErrors.length>0&&(
              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,color:T.muted,marginBottom:6}}>Secciones con mayor error</div>
                {sectionErrors.slice(0,5).map((s,i)=>(
                  <div key={i} onClick={()=>setTopicView?.(s.topicFull)} style={{display:'flex',alignItems:'center',gap:6,padding:'4px 0',cursor:'pointer',borderBottom:`0.5px solid ${T.border}20`}}>
                    <span style={{fontSize:12,fontWeight:700,color:s.score<50?T.red:s.score<70?T.amber:T.green,minWidth:28}}>{s.score}%</span>
                    <span style={{fontSize:11,color:T.text,flex:1}}>{s.topic} · {s.section}</span>
                  </div>
                ))}
              </div>
            )}
            {/* Blind spots — from pre/post + certainty data */}
            {(()=>{
              const certHist=load('olab_certainty_hist',[]);
              const certBlindSpots=certHist.filter(h=>h.certainty==='seguro'&&!h.correct);
              const certCount=certBlindSpots.length;
              return(
                <>
                {(blindSpots.length>0||certCount>0)&&(
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:T.red,marginBottom:4}}>⚠ Puntos ciegos</div>
                    {blindSpots.map((b,i)=>(
                      <div key={i} style={{fontSize:11,color:T.text,padding:'3px 0'}}>
                        {b.topic} · {b.section}: Pre {b.pre}% → Post {b.post}%
                      </div>
                    ))}
                    {certCount>0&&<div style={{fontSize:11,color:T.red,padding:'3px 0'}}>{certCount} respuestas marcadas "Seguro" pero falladas (certeza alta + error)</div>}
                  </div>
                )}
                </>
              );
            })()}
          </Card>
        );
      })()}

      {/* Planificador compacto */}
      <Card style={{padding:'18px 22px'}}>
        <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:12,display:'flex',alignItems:'center',gap:8}}><span style={{width:3,height:16,background:T.amber,borderRadius:2,display:'block'}}/>📅 Planificación</div>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
          <span style={{fontSize:12,color:T.muted}}>Fecha del examen:</span>
          <input type="date" value={examDate} onChange={e=>setExamDate?.(e.target.value)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:6,padding:'4px 8px',fontSize:12,color:T.text,fontFamily:FONT}}/>
        </div>
        {(()=>{
          const weak=ALL_TOPICS.filter(t=>{const s=stats[t];return !s||s.t<4||(s.c/s.t)<0.5;}).slice(0,5);
          if(!weak.length)return <div style={{fontSize:12,color:T.green}}>¡Todos los temas van bien!</div>;
          return(
            <div>
              <div style={{fontSize:11,color:T.muted,fontWeight:600,marginBottom:6}}>Temas que necesitan trabajo:</div>
              {weak.map(t=>(
                <div key={t} onClick={()=>setTopicView?.(t)} style={{fontSize:11,color:T.text,padding:'4px 0',cursor:'pointer',borderBottom:`1px solid ${T.border}20`}} onMouseEnter={e=>e.currentTarget.style.color=T.blue} onMouseLeave={e=>e.currentTarget.style.color=T.text}>{t}</div>
              ))}
            </div>
          );
        })()}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TEMARIO — con notas por sección
// ═══════════════════════════════════════════════════════════════════════════
function Temario({setTab,stats,qs,notes,setNote,pdfMeta,savePdfForTopic,deletePdfForTopic,apiKey,setTopicView,learningData}){
  const [open,setOpen]=useState(null);
  const [openPdf,setOpenPdf]=useState(null); // {topic, fileId, name}
  const studied=ALL_TOPICS.filter(t=>stats[t]?.t>0).length;

  const pctS=Math.round(studied/ALL_TOPICS.length*100);
  const totalPdfs=Object.values(pdfMeta).reduce((a,arr)=>a+(Array.isArray(arr)?arr.length:0),0);
  const getCount=s=>qs.filter(q=>s.topics.includes(q.topic)).length;
  const getAcc=s=>{const rel=Object.entries(stats).filter(([t])=>s.topics.includes(t));if(!rel.length)return null;const tot=rel.reduce((a,[,v])=>a+v.t,0);const cor=rel.reduce((a,[,v])=>a+v.c,0);return tot?Math.round(cor/tot*100):null;};

  return(
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
        <div>
          <h2 style={{fontSize:18,fontWeight:700,margin:'0 0 4px',color:T.text,letterSpacing:-0.3}}>Temario Oficial SESCAM 2025</h2>
          <p style={{color:T.muted,fontSize:13,margin:0}}>FEA Laboratorio Clínico · 60 temas · Anexo II DOCM 9/04/2025</p>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {totalPdfs>0&&<div style={{background:T.greenS,border:`1px solid ${T.border}`,borderRadius:10,padding:'6px 14px',textAlign:'center'}}><div style={{fontSize:16,fontWeight:700,color:T.green}}>{totalPdfs}</div><div style={{fontSize:10,color:T.muted}}>PDFs</div></div>}
          <div style={{background:T.blueS,padding:'8px 16px',borderRadius:10,textAlign:'center'}}><div style={{fontSize:20,fontWeight:700,color:T.blue}}>{pctS}%</div><div style={{fontSize:10,color:T.muted}}>estudiados</div></div>
        </div>
      </div>
      <div style={{background:T.border,borderRadius:4,height:4,margin:'0 0 16px'}}><div style={{background:`linear-gradient(90deg,${T.green},${T.teal})`,width:`${pctS}%`,height:'100%',borderRadius:4,transition:'width 0.5s'}}/></div>
      <div style={{display:'flex',gap:8,marginBottom:20,flexWrap:'wrap'}}>
        <div style={{background:T.blueS,border:`1px solid ${T.border2}`,borderRadius:7,padding:'5px 12px',fontSize:12,color:T.blueText}}>📘 <strong>Tietz</strong> Textbook of Laboratory Medicine (2022)</div>
        <div style={{background:'#fdf6e3',border:'1px solid #d4b44a',borderRadius:7,padding:'5px 12px',fontSize:12,color:T.amberText}}>📙 <strong>Henry</strong> El Laboratorio en el Diagnóstico Clínico (2022)</div>
      </div>

      <div style={{display:'flex',flexDirection:'column',borderRadius:14,overflow:'hidden',border:`1px solid ${T.border}`,boxShadow:sh.sm}}>
        {SECTIONS.map((s,si)=>{
          const acc=getAcc(s);const count=getCount(s);const isOpen=open===s.id;
          const tStr=s.temas.length===1?`T${s.temas[0]}`:`T${s.temas[0]}–T${s.temas[s.temas.length-1]}`;
          const topicsWithData=s.topics.map(t=>{
            const ts=stats[t];const tpct=ts?Math.round(ts.c/ts.t*100):null;
            const st=getStatus(t,stats);const refs=TOPIC_REFS[t];
            const pKey=topicPdfKey(t);const files=pdfMeta[pKey]||[];
            const hasPdfs=files.length>0;
            const ls=learningData[t]?getLearningStatus(learningData[t]):null;
            return{t,ts,tpct,st,refs,pKey,files,hasPdfs,ls};
          });

          return(
            <div key={s.id} style={{borderTop:si>0?`1px solid ${T.border}`:'none'}}>
              {/* Section header row */}
              <div onClick={()=>setOpen(isOpen?null:s.id)}
                style={{display:'flex',alignItems:'center',gap:14,padding:'14px 20px',cursor:'pointer',background:isOpen?s.colorS:T.surface,transition:'background 0.15s'}}>
                <div style={{width:4,height:44,borderRadius:4,background:s.color,flexShrink:0}}/>
                <div style={{width:38,height:38,borderRadius:10,background:isOpen?T.surface:s.colorS,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>{s.emoji}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:14,color:T.text}}>{s.name}</div>
                  <div style={{fontSize:11,color:T.muted,marginTop:2}}>{tStr} · {s.temas.length} temas · {count} preg.</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
                  {acc!==null&&<span style={{fontWeight:700,fontSize:15,color:acc>=70?T.green:acc>=50?T.amber:T.red,minWidth:36,textAlign:'right'}}>{acc}%</span>}
                  <span style={{color:T.dim,fontSize:18,transition:'transform 0.2s',transform:isOpen?'rotate(90deg)':'none',lineHeight:1}}>›</span>
                </div>
              </div>

              {/* Expanded topics */}
              {isOpen&&(
                <div style={{background:T.card,borderTop:`1px solid ${T.border}`}}>
                  {topicsWithData.map(({t,tpct,st,refs,pKey,files,hasPdfs,ls},ti)=>{
                    const hasRefs=refs&&refs.tietz!=='—';
                    return(
                      <div key={t} style={{borderTop:ti>0?`1px solid ${T.border}`:'none',padding:'10px 20px 10px 44px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:10}}>
                          <span style={{width:7,height:7,borderRadius:'50%',background:STATUS_COLORS[st],flexShrink:0}}/>
                          <span onClick={(e)=>{e.stopPropagation();setTopicView(t);}} style={{fontSize:13,color:T.text,flex:1,lineHeight:1.4,fontWeight:500,cursor:'pointer',transition:'color 0.15s'}} onMouseEnter={e=>{e.currentTarget.style.color=T.blue;e.currentTarget.style.textDecoration='underline';}} onMouseLeave={e=>{e.currentTarget.style.color=T.text;e.currentTarget.style.textDecoration='none';}}>{t}</span>
                          <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                            {tpct!==null?(
                              <>
                                <div style={{width:72,height:4,background:T.border,borderRadius:3}}>
                                  <div style={{width:`${tpct}%`,height:'100%',borderRadius:3,background:tpct>=70?T.green:tpct>=50?T.amber:T.red}}/>
                                </div>
                                <span style={{fontSize:12,fontWeight:700,color:tpct>=70?T.green:tpct>=50?T.amber:T.red,minWidth:30,textAlign:'right'}}>{tpct}%</span>
                              </>
                            ):(
                              <span style={{fontSize:10,color:STATUS_COLORS[st],background:STATUS_BG[st],padding:'2px 8px',borderRadius:10,fontWeight:600,whiteSpace:'nowrap'}}>{STATUS_LABELS[st]}</span>
                            )}
                            <button onClick={async()=>{
                              const inp=document.createElement('input');inp.type='file';inp.accept='.pdf';inp.multiple=true;
                              inp.onchange=async e=>{
                                const fs=Array.from(e.target.files||[]);
                                for(const f of fs){
                                  await savePdfForTopic(t,f);
                                }
                              };inp.click();
                            }}
                              style={{background:hasPdfs?T.greenS:T.blueS,border:`1px solid ${hasPdfs?'#b0d8c0':T.border2}`,borderRadius:20,padding:'3px 10px',fontSize:10,cursor:'pointer',color:hasPdfs?T.greenText:T.blueText,fontWeight:600,fontFamily:FONT,whiteSpace:'nowrap'}}>
                              {hasPdfs?`📄 ${files.length}`:'+ PDF'}
                            </button>
                            {ls&&ls.status!=='sinEmpezar'&&(()=>{const lvl=getMasteryLevel(ls.mastery);return(
                              <span style={{background:lvl.color+'18',border:`0.5px solid ${lvl.color}`,borderRadius:20,padding:'3px 8px',fontSize:10,color:lvl.color,fontWeight:700,fontFamily:FONT,whiteSpace:'nowrap'}}>
                                {lvl.emoji} {lvl.name}
                              </span>
                            );})()}
                          </div>
                        </div>
                        {hasRefs&&(
                          <div style={{paddingLeft:17,marginTop:4,display:'flex',gap:5,flexWrap:'wrap'}}>
                            <span style={{fontSize:10,color:T.blueText,background:T.blueS,border:`1px solid ${T.border2}`,padding:'1px 7px',borderRadius:20,fontWeight:600}}>📘 Tietz {refs.tietz}</span>
                            <span style={{fontSize:10,color:T.amberText,background:'#fdf6e3',border:'1px solid #d4b44a',padding:'1px 7px',borderRadius:20,fontWeight:600}}>📙 Henry {refs.henry}</span>
                          </div>
                        )}
                        {/* Texto oficial DOCM */}
                        {(()=>{const num=parseInt(t.match(/^T(\d+)/)?.[1]);const txt=num&&TOPIC_OFFICIAL[num];if(!txt)return null;return(
                          <div style={{paddingLeft:17,marginTop:5}}>
                            <details>
                              <summary style={{fontSize:10,color:T.muted,cursor:'pointer',fontWeight:600,userSelect:'none',listStyle:'none',display:'flex',alignItems:'center',gap:4}}>
                                <span style={{fontSize:9,color:T.dim}}>▶</span> Ver temario oficial DOCM
                              </summary>
                              <div style={{marginTop:6,background:'#fdf6e3',border:'1px solid #d4b44a',borderRadius:7,padding:'8px 12px',fontSize:11,color:T.text,lineHeight:1.7}}>
                                <span style={{fontSize:9,fontWeight:700,color:T.amberText,display:'block',marginBottom:4,letterSpacing:0.5,textTransform:'uppercase'}}>Tema {num} — Texto oficial DOCM 9/04/2025</span>
                                {txt}
                              </div>
                            </details>
                          </div>
                        );})()}
                        {/* PDF viewer inline */}
                      </div>
                    );
                  })}
                  {/* Notes + generate button */}
                  <div style={{padding:'12px 20px',borderTop:`1px solid ${T.border}`,background:s.colorS}}>
                    <div style={{fontSize:11,color:s.color,fontWeight:700,marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Mis notas</div>
                    <textarea defaultValue={notes[s.id]||''} onBlur={e=>setNote(s.id,e.target.value)}
                      placeholder="Notas, esquemas o conceptos clave..."
                      style={{width:'100%',minHeight:60,background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:8,padding:'8px 10px',fontSize:12,fontFamily:FONT,resize:'vertical',outline:'none',boxSizing:'border-box',marginBottom:10}}/>
                    <button onClick={()=>setTab('test')} style={{background:s.color,color:'#fff',border:'none',borderRadius:8,padding:'7px 18px',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:FONT}}>✨ Generar preguntas de este bloque →</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// EstudioTab & StudyPanel DELETED — all apuntes functionality removed
function _EstudioTab_DELETED({studyNotes,saveStudyNote,apiKey,preselect,onPreselect,pdfMeta}){
  const [selectedTopic,setSelectedTopic]=useState(preselect||null);
  const [generating,setGenerating]=useState(false);
  const [genMsg,setGenMsg]=useState('');
  const [search,setSearch]=useState('');
  const [selectedPdfIds,setSelectedPdfIds]=useState(new Set());
  const [manualPdf,setManualPdf]=useState(null);
  const fileRef=useRef(null);

  useEffect(()=>{if(preselect){setSelectedTopic(preselect);onPreselect?.();}},[preselect]);

  // Cuando cambia el tema, seleccionar todos sus PDFs por defecto
  const attachedFiles=selectedTopic?(pdfMeta[topicPdfKey(selectedTopic)]||[]):[];
  useEffect(()=>{
    setSelectedPdfIds(new Set(attachedFiles.map(f=>f.id)));
    setManualPdf(null);
  },[selectedTopic]);

  const togglePdfId=id=>setSelectedPdfIds(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const selectedFiles=attachedFiles.filter(f=>selectedPdfIds.has(f.id));
  const hasPdfSource=manualPdf||(selectedFiles.length>0);

  const generateStudy=async(topic)=>{
    setGenerating(true);setGenMsg(hasPdfSource?'📄 Procesando PDF...':'🤖 Generando apuntes...');
    const refs=TOPIC_REFS[topic];
    const refsStr=refs&&refs.tietz!=='—'?`Referencias: Tietz ${refs.tietz} · Henry ${refs.henry}. `:'';

    // Resolver PDF
    let pdfBlob=null;
    if(manualPdf){
      const chunks=await splitPdfIfNeeded(manualPdf);
      pdfBlob=chunks[0].file;
    } else if(selectedFiles.length>0){
      setGenMsg(`📂 Cargando y fusionando ${selectedFiles.length} PDF${selectedFiles.length>1?'s':''}...`);
      const rawBlobs=[];
      for(const f of selectedFiles){
        const blob=await idbLoad(topicFilePdfKey(topic,f.id)).catch(()=>null);
        if(blob)rawBlobs.push(blob instanceof File?blob:new File([blob],f.name,{type:'application/pdf'}));
      }
      if(rawBlobs.length>0){const{file}=await mergePdfsWithLimit(rawBlobs);pdfBlob=file;}
    }

    const hasPdf=!!pdfBlob;
    const prompt=buildStudyPrompt(topic,hasPdf);

    try{
      setGenMsg(hasPdf?'📄 Analizando capítulo...':'🤖 Generando apuntes...');
      const content=[];
      if(pdfBlob){const b64=await blobToB64(pdfBlob);content.push({type:'document',source:{type:'base64',media_type:'application/pdf',data:b64}});}
      content.push({type:'text',text:prompt});
      const res=await fetch('/api/anthropic',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:8192,messages:[{role:'user',content}]})
      });
      if(!res.ok){const d=await res.json().catch(()=>({}));throw new Error(d?.error?.message||`HTTP ${res.status}`);}
      const data=await res.json();
      const text=(data.content||[]).map(c=>c.text||'').join('').trim();
      const cleaned=text.replace(/```json|```/g,'').trim();
      const parsed=JSON.parse(repairJSON(cleaned));
      saveStudyNote(topic,parsed);
      setGenMsg('');
    }catch(e){setGenMsg(`❌ ${e.message}`);}
    setGenerating(false);
  };

  const totalNotes=Object.keys(studyNotes).length;
  const filtered=search.trim()?ALL_TOPICS.filter(t=>t.toLowerCase().includes(search.toLowerCase())):null;

  return(
    <div style={{display:'flex',gap:0,height:'calc(100vh - 120px)',minHeight:600}}>
      {/* Sidebar */}
      <div style={{width:300,flexShrink:0,borderRight:`1px solid ${T.border}`,overflowY:'auto'}}>
        <div style={{padding:'0 12px 12px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div style={{fontSize:13,fontWeight:700,color:T.text}}>Temas</div>
            <span style={{fontSize:11,color:T.muted,background:T.card,padding:'2px 8px',borderRadius:20}}>{totalNotes}/60 generados</span>
          </div>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar tema..." style={{width:'100%',background:T.card,color:T.text,border:`1px solid ${T.border}`,borderRadius:7,padding:'7px 10px',fontSize:12,outline:'none',boxSizing:'border-box',fontFamily:FONT,marginBottom:8}}/>
        </div>
        {(filtered?[{id:'search',name:'Resultados',topics:filtered,color:T.blue,colorS:T.blueS,emoji:'🔍'}]:SECTIONS).map(s=>(
          <div key={s.id}>
            <div style={{padding:'5px 12px',fontSize:10,fontWeight:700,color:s.color,letterSpacing:0.5,textTransform:'uppercase',background:s.colorS,borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`}}>{s.emoji} {s.name}</div>
            {s.topics.map(t=>{
              const hasNote=!!studyNotes[t];
              const isSel=selectedTopic===t;
              const nPdfs=(pdfMeta[topicPdfKey(t)]||[]).length;
              return(
                <div key={t} onClick={()=>setSelectedTopic(t)} style={{padding:'8px 12px',cursor:'pointer',background:isSel?T.blueS:'transparent',borderLeft:`3px solid ${isSel?T.blue:'transparent'}`,borderBottom:`1px solid ${T.border}20`,transition:'all 0.1s',display:'flex',alignItems:'center',gap:6}}>
                  <span style={{width:6,height:6,borderRadius:'50%',background:hasNote?T.teal:T.border,flexShrink:0,display:'block'}}/>
                  <span style={{fontSize:11,color:isSel?T.blue:T.text,lineHeight:1.3,flex:1}}>{t}</span>
                  {nPdfs>0&&<span style={{fontSize:9,background:T.greenS,color:T.greenText,padding:'1px 5px',borderRadius:8,fontWeight:700,flexShrink:0}}>📄{nPdfs}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Main content */}
      <div style={{flex:1,overflowY:'auto',padding:'0 24px 24px'}}>
        {!selectedTopic?(
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',textAlign:'center',color:T.muted}}>
            <div style={{fontSize:48,marginBottom:16}}>📖</div>
            <div style={{fontSize:16,fontWeight:600,color:T.text,marginBottom:8}}>Selecciona un tema</div>
            <div style={{fontSize:13,maxWidth:320,lineHeight:1.6}}>Elige un tema del panel izquierdo. Los temas con 📄 tienen PDFs adjuntos — los apuntes se generarán directamente desde el libro.</div>
          </div>
        ):(
          <div>
            <div style={{position:'sticky',top:0,background:T.bg,paddingTop:20,paddingBottom:14,zIndex:10,borderBottom:`1px solid ${T.border}`,marginBottom:16}}>
              <div style={{fontSize:11,color:T.muted,marginBottom:4,fontWeight:600,letterSpacing:0.3,textTransform:'uppercase'}}>Apuntes de estudio</div>
              <div style={{fontSize:15,fontWeight:700,color:T.text,lineHeight:1.4,marginBottom:12}}>{selectedTopic}</div>

              {/* PDF source selector */}
              {attachedFiles.length>0&&!manualPdf&&(
                <div style={{background:T.greenS,border:'1px solid #b0d8c0',borderLeft:`3px solid ${T.green}`,borderRadius:8,padding:'10px 14px',marginBottom:10}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                    <span style={{fontSize:12,color:T.greenText,fontWeight:600}}>📗 PDFs adjuntos — selecciona la fuente</span>
                    <div style={{display:'flex',gap:5}}>
                      <button onClick={()=>setSelectedPdfIds(new Set(attachedFiles.map(f=>f.id)))} style={{fontSize:10,background:'none',border:`1px solid ${T.border2}`,borderRadius:5,padding:'1px 6px',cursor:'pointer',color:T.muted,fontFamily:FONT}}>Todo</button>
                      <button onClick={()=>setSelectedPdfIds(new Set())} style={{fontSize:10,background:'none',border:`1px solid ${T.border2}`,borderRadius:5,padding:'1px 6px',cursor:'pointer',color:T.muted,fontFamily:FONT}}>Ninguno</button>
                    </div>
                  </div>
                  {attachedFiles.map(f=>{
                    const sel=selectedPdfIds.has(f.id);
                    return(
                      <label key={f.id} style={{display:'flex',alignItems:'center',gap:7,background:sel?'#d4f0e0':T.card,borderRadius:5,padding:'4px 8px',marginBottom:3,cursor:'pointer',border:`1px solid ${sel?'#b0d8c0':T.border}`}}>
                        <input type="checkbox" checked={sel} onChange={()=>togglePdfId(f.id)} style={{accentColor:T.green,flexShrink:0}}/>
                        <span style={{fontSize:11,flex:1,color:sel?T.greenText:T.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:sel?600:400}}>📄 {f.name}</span>
                        {f.pages&&<span style={{fontSize:9,color:T.dim,background:T.surface,padding:'1px 5px',borderRadius:8}}>pp.{f.pages}</span>}
                        <span style={{fontSize:10,color:T.dim,flexShrink:0}}>{(f.size/1024/1024).toFixed(1)}MB</span>
                      </label>
                    );
                  })}
                  <button onClick={()=>fileRef.current?.click()} style={{marginTop:4,fontSize:10,background:'none',border:`1px solid ${T.border2}`,borderRadius:5,padding:'2px 8px',cursor:'pointer',color:T.muted,fontFamily:FONT}}>+ Subir otro PDF</button>
                </div>
              )}
              {manualPdf&&(
                <div style={{background:T.blueS,border:'1px solid #b0d0e0',borderLeft:`3px solid ${T.blue}`,borderRadius:8,padding:'9px 14px',marginBottom:10,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8}}><span>📄</span><div><div style={{fontSize:12,color:T.blue,fontWeight:600}}>{manualPdf.name}</div><div style={{fontSize:10,color:T.muted}}>PDF manual</div></div></div>
                  <button onClick={()=>setManualPdf(null)} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:18}}>×</button>
                </div>
              )}
              {!attachedFiles.length&&!manualPdf&&(
                <div onClick={()=>fileRef.current?.click()} style={{border:`2px dashed ${T.border2}`,borderRadius:8,padding:'10px',textAlign:'center',cursor:'pointer',marginBottom:10,background:T.card,fontSize:12,color:T.muted,transition:'all 0.15s'}} onMouseEnter={e=>{e.currentTarget.style.borderColor=T.blue;e.currentTarget.style.background=T.blueS;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border2;e.currentTarget.style.background=T.card;}}>
                  📄 Subir PDF del capítulo (opcional) — o genera con conocimiento general
                </div>
              )}
              <input ref={fileRef} type="file" accept=".pdf" onChange={e=>{const f=e.target.files?.[0];if(f)setManualPdf(f);}} style={{display:'none'}}/>

              <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                {studyNotes[selectedTopic]
                  ?<button onClick={()=>generateStudy(selectedTopic)} disabled={generating} style={{background:T.card,border:`1px solid ${T.border2}`,borderRadius:7,padding:'6px 14px',fontSize:12,cursor:'pointer',color:T.muted,fontFamily:FONT}}>{generating?'⏳ Regenerando…':'🔄 Regenerar apuntes'}</button>
                  :<button onClick={()=>generateStudy(selectedTopic)} disabled={generating} style={{background:hasPdfSource?T.green:T.teal,color:'#fff',border:'none',borderRadius:7,padding:'8px 18px',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:FONT,boxShadow:sh.sm}}>{generating?'⏳ Generando…':hasPdfSource?'📄 Generar desde PDF':'📖 Generar con IA'}</button>
                }
                {genMsg&&<span style={{fontSize:12,color:genMsg.startsWith('❌')?T.red:T.muted,alignSelf:'center'}}>{genMsg}</span>}
              </div>
            </div>
            {studyNotes[selectedTopic]
              ?<StudyPanel data={studyNotes[selectedTopic].content} topic={selectedTopic} date={studyNotes[selectedTopic].date} onRegenerate={()=>generateStudy(selectedTopic)} isGenerating={generating}/>
              :<div style={{textAlign:'center',padding:'60px 20px',color:T.muted}}>
                <div style={{fontSize:40,marginBottom:12}}>📝</div>
                <div style={{fontSize:14,marginBottom:6,color:T.text,fontWeight:600}}>Este tema aún no tiene apuntes</div>
                <div style={{fontSize:12}}>{hasPdfSource?'Pulsa "Generar desde PDF" para crear el resumen desde el libro':'Pulsa "Generar con IA" para crear el resumen de estudio'}</div>
              </div>
            }
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STUDY PANEL
// ═══════════════════════════════════════════════════════════════════════════
function StudyPanel({data,topic,date,onRegenerate,isGenerating}){
  if(!data)return null;
  const sectionColors={
    'Valores de referencia':{bg:'#eff6ff',border:'#b0d0e0',title:'#1d4ed8',icon:'🔢'},
    'Conceptos clave':{bg:T.greenS,border:'#b0d8c0',title:T.greenText,icon:'💡'},
    'Mecanismos fisiopatológicos':{bg:'#faf5ff',border:'#d8b4fe',title:'#7c3aed',icon:'⚙️'},
    'Clasificaciones y criterios diagnósticos':{bg:T.amberS,border:'#d4b44a',title:T.amberText,icon:'📋'},
    'Técnicas analíticas de laboratorio':{bg:'#f0fdf4',border:'#d4f0e0',title:'#166534',icon:'🔬'},
    'Perlas para el examen':{bg:'#fff7ed',border:'#fed7aa',title:'#c2410c',icon:'💎'},
  };
  return(
    <div style={{padding:'14px 14px 16px'}}>
      {data.resumen&&<p style={{fontSize:13,color:T.muted,lineHeight:1.7,margin:'0 0 16px',padding:'12px 16px',background:T.card,borderRadius:10,borderLeft:`3px solid ${T.teal}`}}>{data.resumen}</p>}
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        {(data.subapartados||[]).map((sec,i)=>{
          const col=sectionColors[sec.titulo]||{bg:T.card,border:T.border,title:T.text,icon:'📌'};
          const hasConceptos=Array.isArray(sec.conceptos)&&sec.conceptos.length>0;
          return(
            <div key={i} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,overflow:'hidden',boxShadow:sh.sm}}>
              {/* Section header */}
              <div style={{padding:'10px 14px',background:col.bg,borderBottom:`1px solid ${col.border}`,display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:15}}>{col.icon}</span>
                <span style={{fontSize:13,fontWeight:700,color:col.title,letterSpacing:0.2}}>{sec.titulo}</span>
                {hasConceptos&&<span style={{marginLeft:'auto',fontSize:10,color:col.title,background:col.border+'50',padding:'1px 8px',borderRadius:20,fontWeight:600}}>{sec.conceptos.length} conceptos</span>}
              </div>
              <div style={{padding:'12px 14px'}}>
                {/* NEW FORMAT: conceptos con nombre + explicacion */}
                {hasConceptos&&(
                  <div style={{display:'flex',flexDirection:'column',gap:10}}>
                    {sec.conceptos.map((c,j)=>(
                      <div key={j} style={{borderLeft:`3px solid ${col.border}`,paddingLeft:12,paddingTop:2,paddingBottom:2}}>
                        <div style={{fontSize:12,fontWeight:700,color:col.title,marginBottom:4,display:'flex',alignItems:'center',gap:6}}>
                          <span style={{width:18,height:18,borderRadius:'50%',background:col.bg,border:`1px solid ${col.border}`,display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:800,color:col.title,flexShrink:0}}>{j+1}</span>
                          {c.nombre||c.titulo||'Concepto'}
                        </div>
                        <div style={{fontSize:12,color:T.text,lineHeight:1.75}}>{c.explicacion||c.descripcion||''}</div>
                      </div>
                    ))}
                  </div>
                )}
                {/* LEGACY FORMAT: tabla */}
                {!hasConceptos&&sec.tipo==='tabla'&&sec.filas&&(
                  <div style={{overflowX:'auto'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                      {sec.cabeceras&&<thead><tr>{sec.cabeceras.map((h,j)=><th key={j} style={{padding:'6px 10px',background:col.border+'80',color:col.title,fontWeight:700,textAlign:'left',borderBottom:`1px solid ${col.border}`,whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>}
                      <tbody>{sec.filas.map((row,j)=><tr key={j} style={{background:j%2===0?'transparent':col.border+'20'}}>{(Array.isArray(row)?row:[row]).map((cell,k)=><td key={k} style={{padding:'6px 10px',color:T.text,borderBottom:`1px solid ${col.border}40`,verticalAlign:'top',lineHeight:1.5}}>{cell}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                )}
                {/* LEGACY FORMAT: lista */}
                {!hasConceptos&&sec.tipo==='lista'&&<ul style={{margin:0,paddingLeft:20,display:'flex',flexDirection:'column',gap:5}}>{(sec.items||[]).map((item,j)=><li key={j} style={{fontSize:12,color:T.text,lineHeight:1.65}}>{item}</li>)}</ul>}
                {/* LEGACY FORMAT: clasificacion */}
                {!hasConceptos&&sec.tipo==='clasificacion'&&<div style={{display:'flex',flexDirection:'column',gap:10}}>{(sec.items||[]).map((cls,j)=><div key={j}><div style={{fontSize:12,fontWeight:700,color:col.title,marginBottom:4}}>{cls.nombre}</div><ul style={{margin:0,paddingLeft:18,display:'flex',flexDirection:'column',gap:2}}>{(cls.criterios||[]).map((c,k)=><li key={k} style={{fontSize:12,color:T.text,lineHeight:1.6}}>{c}</li>)}</ul></div>)}</div>}
                {/* LEGACY FORMAT: perlas */}
                {!hasConceptos&&sec.tipo==='perlas'&&<div style={{display:'flex',flexDirection:'column',gap:7}}>{(sec.items||[]).map((item,j)=><div key={j} style={{display:'flex',gap:10,alignItems:'flex-start',background:T.amberS,borderRadius:7,padding:'7px 10px'}}><span style={{fontSize:14,flexShrink:0}}>💎</span><span style={{fontSize:12,color:T.amberText,lineHeight:1.6,fontWeight:500}}>{item}</span></div>)}</div>}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:12}}>
        <span style={{fontSize:10,color:T.dim}}>Generado el {fmtDate(date)}</span>
        <button onClick={onRegenerate} disabled={isGenerating} style={{fontSize:11,background:'none',border:`1px solid ${T.border2}`,borderRadius:6,padding:'3px 10px',cursor:'pointer',color:T.muted,fontFamily:FONT}}>
          {isGenerating?'⏳ Regenerando…':'🔄 Regenerar'}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TOPIC PAGE — Vista dedicada de un tema con 4 tabs
// ═══════════════════════════════════════════════════════════════════════════
function TopicPage({topic,onBack,stats,qs,pdfMeta,savePdfForTopic,deletePdfForTopic,apiKey,learningData,saveLearningData,sr,recordAnswer,goToBank,setTab,saveQs,bgJobs,startBgJob,clearJob}){
  const [activeTab,setActiveTab]=useState('temario');
  const [viewingPdf,setViewingPdf]=useState(null); // {source, fileId, name}
  const refs=TOPIC_REFS[topic];
  const hasRefs=refs&&refs.tietz!=='—';
  const topicNum=parseInt(topic.match(/^T(\d+)/)?.[1]);
  const officialText=topicNum&&TOPIC_OFFICIAL[topicNum];
  const pKey=topicPdfKey(topic);
  const files=pdfMeta[pKey]||[];
  const tietzKey=pKey+'_T';const henryKey=pKey+'_H';
  const tietzFiles=pdfMeta[tietzKey]||[];
  const henryFiles=pdfMeta[henryKey]||[];
  const topicQs=qs.filter(q=>q.topic===topic);
  const topicStats=stats[topic];
  const status=getStatus(topic,stats);
  const learning=learningData[topic];
  const section=SECTIONS.find(s=>s.topics.includes(topic));
  const ls=learning?getLearningStatus(learning):null;

  // Upload PDF for Tietz/Henry — validates source separation, replaces old splits
  const uploadPdf=(source)=>{
    const inp=document.createElement('input');inp.type='file';inp.accept='.pdf';
    inp.onchange=async e=>{
      const f=e.target.files?.[0];if(!f)return;
      // Validate: check if same file name exists in the OTHER source
      const otherSource=source==='tietz'?'henry':'tietz';
      const otherFiles=pdfMeta[topicPdfKey(topic+'§'+otherSource)]||[];
      if(otherFiles.some(of=>of.name===f.name)){
        alert(`Este archivo "${f.name}" ya está subido en ${otherSource==='tietz'?'Tietz':'Henry'}. Cada PDF debe pertenecer a una sola fuente.`);
        return;
      }
      // Clear any previous files for this source (replaces old split versions)
      const existingKey=topicPdfKey(topic+'§'+source);
      const existingFiles=pdfMeta[existingKey]||[];
      if(existingFiles.length>0){
        for(const old of existingFiles)await idbDel(topicFilePdfKey(topic+'§'+source,old.id));
        setPdfMetaState(prev=>{const n={...prev};delete n[existingKey];save('olab_pdf_meta',n);return n;});
      }
      await savePdfForTopic(topic+'§'+source,f);
    };inp.click();
  };
  const tietzFilesReal=pdfMeta[topicPdfKey(topic+'§tietz')]||[];
  const henryFilesReal=pdfMeta[topicPdfKey(topic+'§henry')]||[];

  const tabs=[
    {id:'temario',label:'Temario',icon:'📋',color:T.blue},
    {id:'aprendizaje',label:'Aprendizaje',icon:'🧠',color:T.purple},
    {id:'apuntes',label:'Apuntes',icon:'📖',color:T.teal},
    {id:'preguntas',label:'Preguntas',icon:'🧪',color:T.orange},
  ];
  // Collect ALL questions for this topic: from question bank + from learning phases
  const allTopicQuestions=useMemo(()=>{
    const fromBank=topicQs;
    const fromLearning=[];
    if(learning?.sections){
      learning.sections.forEach(sec=>{
        const gen=sec.generated;if(!gen)return;
        (gen.phases?.preTest||[]).forEach(q=>fromLearning.push({...q,type:'test',topic,_source:'pretest',_section:sec.title}));
        (gen.phases?.postTest||[]).forEach(q=>fromLearning.push({...q,type:'test',topic,_source:'posttest',_section:sec.title}));
        (gen.phases?.flashcards||[]).forEach(q=>fromLearning.push({...q,type:'flashcard',topic,_source:'flashcard',_section:sec.title,question:q.front}));
        (gen.phases?.clinicalCases||[]).forEach(q=>fromLearning.push({...q,type:'test',topic,_source:'caso',_section:sec.title}));
        // subsections
        (sec.subsections||[]).forEach(sub=>{
          const sg=sub.generated;if(!sg)return;
          (sg.phases?.preTest||[]).forEach(q=>fromLearning.push({...q,type:'test',topic,_source:'pretest',_section:`${sec.title} > ${sub.title}`}));
          (sg.phases?.postTest||[]).forEach(q=>fromLearning.push({...q,type:'test',topic,_source:'posttest',_section:`${sec.title} > ${sub.title}`}));
          (sg.phases?.flashcards||[]).forEach(q=>fromLearning.push({...q,type:'flashcard',topic,_source:'flashcard',_section:`${sec.title} > ${sub.title}`,question:q.front}));
          (sg.phases?.clinicalCases||[]).forEach(q=>fromLearning.push({...q,type:'test',topic,_source:'caso',_section:`${sec.title} > ${sub.title}`}));
        });
      });
    }
    // Dedupe by id
    const seen=new Set(fromBank.map(q=>q.id));
    const merged=[...fromBank];
    fromLearning.forEach(q=>{if(!seen.has(q.id)){seen.add(q.id);merged.push(q);}});
    return merged;
  },[topicQs,learning]);

  return(
    <div>
      <div style={{marginBottom:20}}>
        <button onClick={onBack} style={{background:'none',border:'none',cursor:'pointer',color:T.muted,fontSize:13,fontFamily:FONT,display:'flex',alignItems:'center',gap:4,padding:0,marginBottom:12}}>← Volver al temario</button>
        <div style={{display:'flex',alignItems:'flex-start',gap:14}}>
          <div style={{width:42,height:42,borderRadius:10,background:section?.colorS||T.blueS,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>{section?.emoji||'📚'}</div>
          <div style={{flex:1}}>
            <h2 style={{fontSize:20,fontWeight:700,margin:'0 0 6px',color:T.text,letterSpacing:-0.3,lineHeight:1.3}}>{topic}</h2>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
              <span style={{fontSize:11,color:STATUS_COLORS[status],background:STATUS_BG[status],padding:'2px 8px',borderRadius:10,fontWeight:600}}>{STATUS_LABELS[status]}</span>
              {topicStats&&<span style={{fontSize:11,color:T.muted}}>{topicStats.c}/{topicStats.t} ({Math.round(topicStats.c/topicStats.t*100)}%)</span>}
              {topicQs.length>0&&<span style={{fontSize:11,color:T.blue,background:T.blueS,padding:'2px 8px',borderRadius:10,fontWeight:600}}>{topicQs.length} preg.</span>}
              {files.length>0&&<span style={{fontSize:11,color:T.greenText,background:T.greenS,padding:'2px 8px',borderRadius:10,fontWeight:600}}>📄 {files.length} PDFs</span>}
              {ls&&ls.status!=='sinEmpezar'&&(()=>{const lvl=getMasteryLevel(ls.mastery);return <span style={{fontSize:11,color:lvl.color,background:lvl.color+'18',padding:'2px 8px',borderRadius:10,fontWeight:600}}>{lvl.emoji} {lvl.name} · {ls.mastery}%</span>;})()}
            </div>
          </div>
        </div>
      </div>

      <div style={{display:'flex',borderBottom:`1px solid ${T.border}`,marginBottom:22,gap:0}}>
        {tabs.map(t=>{
          const hasActiveJob=Object.values(bgJobs||{}).some(j=>j.status==='running'&&j.type?.includes(t.id));
          return(
            <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{padding:'8px 14px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:activeTab===t.id?600:400,color:activeTab===t.id?t.color:T.muted,borderBottom:`2px solid ${activeTab===t.id?t.color:'transparent'}`,fontFamily:FONT,display:'flex',alignItems:'center',gap:4}}>
              {t.icon} {t.label}
              {hasActiveJob&&<span style={{width:6,height:6,borderRadius:'50%',background:T.green,display:'inline-block',animation:'pulse 1.5s infinite'}}/>}
            </button>
          );
        })}
      </div>

      <div style={{display:activeTab==='temario'?'block':'none'}}>{(()=>(
        <div>
          {officialText&&(
            <Card style={{padding:'18px 22px',marginBottom:16,borderLeft:`3px solid #d4b44a`}}>
              <div style={{fontSize:10,fontWeight:700,color:T.amberText,marginBottom:8,letterSpacing:0.5,textTransform:'uppercase'}}>Tema {topicNum} — Texto oficial DOCM 9/04/2025</div>
              <div style={{fontSize:13,color:T.text,lineHeight:1.8}}>{officialText}</div>
            </Card>
          )}

          {/* PDF Tietz & Henry — subir y visualizar */}
          <div style={{display:'flex',gap:12,marginBottom:16,flexWrap:'wrap'}}>
            {/* Tietz */}
            <Card style={{padding:'14px 18px',flex:1,minWidth:280}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:T.blueText}}>📘 Tietz {hasRefs?refs.tietz:''}</div>
                <button onClick={()=>uploadPdf('tietz')} style={{fontSize:10,background:T.blueS,border:`1px solid ${T.border2}`,borderRadius:6,padding:'3px 10px',cursor:'pointer',color:T.blueText,fontWeight:600,fontFamily:FONT}}>
                  {tietzFilesReal.length?'+ Añadir':'Subir PDF'}
                </button>
              </div>
              {hasRefs&&refs.tietzD&&<div style={{fontSize:10,color:T.muted,marginBottom:6}}>{refs.tietzD}</div>}
              {tietzFilesReal.length>0?(
                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                  {tietzFilesReal.map(f=>{
                    const isViewing=viewingPdf?.source==='tietz'&&viewingPdf?.fileId===f.id;
                    return(
                      <div key={f.id} style={{display:'flex',alignItems:'center',gap:6,background:isViewing?T.blueS:T.card,border:`1px solid ${isViewing?T.blue:T.border}`,borderRadius:6,padding:'5px 8px'}}>
                        <button onClick={()=>setViewingPdf(isViewing?null:{source:'tietz',fileId:f.id,name:f.name,topicKey:topic+'§tietz'})}
                          style={{background:'none',border:'none',cursor:'pointer',fontSize:11,color:isViewing?T.blue:T.text,fontWeight:600,flex:1,textAlign:'left',fontFamily:FONT}}>
                          {isViewing?'▼ ':'📄 '}{f.name} {f.pages&&<span style={{color:T.muted,fontWeight:400}}>pp.{f.pages}</span>}
                        </button>
                        <button onClick={()=>deletePdfForTopic(topic+'§tietz',f.id)} style={{background:'none',border:'none',cursor:'pointer',color:T.dim,fontSize:12}}>×</button>
                      </div>
                    );
                  })}
                </div>
              ):(
                <div style={{fontSize:11,color:T.dim,textAlign:'center',padding:'8px 0'}}>Sin PDF subido</div>
              )}
            </Card>

            {/* Henry */}
            <Card style={{padding:'14px 18px',flex:1,minWidth:280}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:T.amberText}}>📙 Henry {hasRefs?refs.henry:''}</div>
                <button onClick={()=>uploadPdf('henry')} style={{fontSize:10,background:'#fdf6e3',border:'1px solid #d4b44a',borderRadius:6,padding:'3px 10px',cursor:'pointer',color:T.amberText,fontWeight:600,fontFamily:FONT}}>
                  {henryFilesReal.length?'+ Añadir':'Subir PDF'}
                </button>
              </div>
              {hasRefs&&refs.henryD&&<div style={{fontSize:10,color:T.muted,marginBottom:6}}>{refs.henryD}</div>}
              {henryFilesReal.length>0?(
                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                  {henryFilesReal.map(f=>{
                    const isViewing=viewingPdf?.source==='henry'&&viewingPdf?.fileId===f.id;
                    return(
                      <div key={f.id} style={{display:'flex',alignItems:'center',gap:6,background:isViewing?T.amberS:T.card,border:`1px solid ${isViewing?T.amber:T.border}`,borderRadius:6,padding:'5px 8px'}}>
                        <button onClick={()=>setViewingPdf(isViewing?null:{source:'henry',fileId:f.id,name:f.name,topicKey:topic+'§henry'})}
                          style={{background:'none',border:'none',cursor:'pointer',fontSize:11,color:isViewing?T.amber:T.text,fontWeight:600,flex:1,textAlign:'left',fontFamily:FONT}}>
                          {isViewing?'▼ ':'📄 '}{f.name} {f.pages&&<span style={{color:T.muted,fontWeight:400}}>pp.{f.pages}</span>}
                        </button>
                        <button onClick={()=>deletePdfForTopic(topic+'§henry',f.id)} style={{background:'none',border:'none',cursor:'pointer',color:T.dim,fontSize:12}}>×</button>
                      </div>
                    );
                  })}
                </div>
              ):(
                <div style={{fontSize:11,color:T.dim,textAlign:'center',padding:'8px 0'}}>Sin PDF subido</div>
              )}
            </Card>
          </div>

          {/* PDF Processing */}
          {(tietzFilesReal.length>0||henryFilesReal.length>0)&&(
            <PdfProcessorUI topic={topic} pdfMeta={pdfMeta} learning={learning} saveLearningData={saveLearningData}/>
          )}

          {/* Section index from learning data */}
          {learning?.sections?.length>0&&(
            <Card style={{padding:'14px 18px',marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:700,color:T.text,marginBottom:8}}>📑 Secciones del tema ({learning.sections.length})</div>
              <div style={{display:'flex',flexDirection:'column',gap:3}}>
                {learning.sections.map((sec,i)=>{
                  const hasTietz=sec.text?.includes('[Fuente: Tietz]');
                  const hasHenry=sec.text?.includes('[Fuente: Henry]');
                  const src=hasTietz&&hasHenry?'T+H':hasTietz?'T':hasHenry?'H':null;
                  const hasGen=!!sec.generated;
                  return(
                    <div key={sec.id||i} onClick={()=>setActiveTab('aprendizaje')} style={{display:'flex',alignItems:'center',gap:6,padding:'4px 8px',borderRadius:6,cursor:'pointer',background:T.bg,border:`0.5px solid ${T.border}`}} onMouseEnter={e=>e.currentTarget.style.borderColor=T.teal} onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
                      <span style={{fontSize:9,color:T.dim,fontWeight:700,minWidth:16}}>{i+1}</span>
                      <span style={{fontSize:11,color:T.text,flex:1}}>{sec.title}</span>
                      {src&&<span style={{fontSize:8,color:T.teal,background:T.tealS,padding:'1px 4px',borderRadius:3,fontWeight:700}}>{src}</span>}
                      {sec.pageStart&&<span style={{fontSize:9,color:T.dim}}>p.{sec.pageStart}</span>}
                      {hasGen&&<span style={{fontSize:8,color:T.green}}>✓</span>}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Inline PDF viewer */}
          {viewingPdf&&(
            <PdfViewer topic={viewingPdf.topicKey} fileId={viewingPdf.fileId} name={viewingPdf.name} onClose={()=>setViewingPdf(null)}/>
          )}

        </div>
      ))()}</div>

      <div style={{display:activeTab==='aprendizaje'?'block':'none'}}><AprendizajeTab topic={topic} learning={learning} saveLearningData={saveLearningData} pdfMeta={pdfMeta} bgJobs={bgJobs} startBgJob={startBgJob} clearJob={clearJob} allLearningData={learningData} setTopicView={onBack}/></div>

      <div style={{display:activeTab==='apuntes'?'block':'none'}}><TopicApuntesTab topic={topic} learning={learning} saveLearningData={saveLearningData} bgJobs={bgJobs} startBgJob={startBgJob} clearJob={clearJob}/></div>

      <div style={{display:activeTab==='preguntas'?'block':'none'}}><TopicPreguntasTab topic={topic} allQuestions={allTopicQuestions} topicTag={topicNum?`T${topicNum}`:''} stats={stats} saveQs={saveQs} qs={qs} apiKey={apiKey} learning={learning} bgJobs={bgJobs} startBgJob={startBgJob} clearJob={clearJob}/></div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PDF PROCESSOR — extracción local con pdf.js + 1 llamada API para títulos
// ═══════════════════════════════════════════════════════════════════════════
function PdfProcessorUI({topic,pdfMeta,learning,saveLearningData}){
  const storeKey='olab_pdfproc_'+topic.replace(/[^a-z0-9]/gi,'').slice(0,30);
  const [processing,setProcessing]=useState(null);
  const [progress,setProgress]=useState({step:'',pct:0,detail:''});
  const [pdfData,setPdfData]=useState(()=>load(storeKey,{tietz:null,henry:null}));
  const [editingSections,setEditingSections]=useState(null);
  const [editSource,setEditSource]=useState(null);
  const [manualMode,setManualMode]=useState(false);
  const [manualText,setManualText]=useState('');
  const [treeNodes,setTreeNodes]=useState([]); // [{id,title,level,children:[]}]
  const [editingNodeId,setEditingNodeId]=useState(null);
  const [dragNode,setDragNode]=useState(null);

  // ── Extract text from PDF with font metadata ─────────────────────────────
  const extractPdfText=async(blob,fileLabel)=>{
    const buf=await blob.arrayBuffer();
    const pdf=await pdfjsLib.getDocument({data:buf}).promise;
    const totalPages=pdf.numPages;
    const pages=[];
    for(let p=1;p<=totalPages;p++){
      setProgress(prev=>({...prev,detail:`${fileLabel||'PDF'} · página ${p}/${totalPages}`}));
      const page=await pdf.getPage(p);
      const content=await page.getTextContent();
      const items=content.items.filter(it=>it.str.trim());
      // Build lines with font info
      let lines=[];let curLine={text:'',fontSize:0,bold:false,y:0};
      for(const it of items){
        const y=Math.round(it.transform[5]);
        const fs=Math.round(it.transform[0])||Math.round(it.height)||12; // font size from transform matrix
        const isBold=/bold/i.test(it.fontName||'');
        if(curLine.text&&Math.abs(y-curLine.y)>3){
          if(curLine.text.trim())lines.push({text:curLine.text.trim(),fontSize:curLine.fontSize,bold:curLine.bold,y:curLine.y});
          curLine={text:it.str,fontSize:fs,bold:isBold,y};
        }else{
          curLine.text+=(curLine.text?' ':'')+it.str;
          curLine.fontSize=Math.max(curLine.fontSize,fs);
          if(isBold)curLine.bold=true;
          curLine.y=y;
        }
      }
      if(curLine.text.trim())lines.push({text:curLine.text.trim(),fontSize:curLine.fontSize,bold:curLine.bold,y:curLine.y});
      pages.push({pageNum:p,lines});
    }
    // Extract PDF bookmarks/outline if available
    let bookmarks=[];
    try{
      const outline=await pdf.getOutline();
      if(outline?.length){
        const flattenOutline=(items,level=1)=>{
          for(const item of items){
            if(item.title)bookmarks.push({title:item.title.trim(),level,dest:item.dest});
            if(item.items?.length&&level<2)flattenOutline(item.items,level+1);
          }
        };
        flattenOutline(outline);
      }
    }catch{}
    return{pages,totalPages,bookmarks};
  };

  // ── Find all title positions in flat text array in a single pass ────────
  // ── Find title positions: scan flat lines, match titles IN ORDER ────────
  // Key fix: each title is searched only AFTER the previous one's position,
  // preventing early substring matches from pulling text from wrong sections.
  const findTitlePositions=(flat,titles)=>{
    const positions=new Map();
    const titleNorms=titles.map(t=>(typeof t==='string'?t:t).toLowerCase().trim());
    let searchFrom=0; // enforce forward-only matching

    for(let ti=0;ti<titleNorms.length;ti++){
      const tn=titleNorms[ti];
      if(tn.length<2)continue;
      let bestIdx=-1;
      // Pass 1: exact line match or startsWith (strongest signal)
      for(let li=searchFrom;li<flat.length;li++){
        const lineN=flat[li].text.toLowerCase().trim();
        if(lineN===tn||(lineN.startsWith(tn)&&lineN.length<tn.length+30)){
          bestIdx=li;break;
        }
      }
      // Pass 2: short line contains title (heading-like)
      if(bestIdx<0){
        for(let li=searchFrom;li<flat.length;li++){
          if(flat[li].text.length<120&&flat[li].text.toLowerCase().includes(tn)){
            bestIdx=li;break;
          }
        }
      }
      // Pass 3: partial match (first 15 chars) — last resort
      if(bestIdx<0&&tn.length>4){
        const partial=tn.slice(0,15);
        for(let li=searchFrom;li<flat.length;li++){
          if(flat[li].text.length<120&&flat[li].text.toLowerCase().includes(partial)){
            bestIdx=li;break;
          }
        }
      }
      if(bestIdx>=0){
        positions.set(ti,bestIdx);
        console.log(`[FindTitle] "${titleNorms[ti]}" → line ${bestIdx} (page ${flat[bestIdx]?.page||'?'}): "${flat[bestIdx]?.text.slice(0,60)}"`);
        searchFrom=bestIdx+1;
      }else{
        console.warn(`[FindTitle] "${titleNorms[ti]}" → NOT FOUND (searched from line ${searchFrom})`);
      }
    }
    return positions;
  };

  // ── Split flat text between consecutive title positions ────────────────
  // Each section gets text from its title line to the line BEFORE the next title.
  // No section can overlap with another. Total words = document words.
  const splitTextAtTitles=(flat,titles,positions)=>{
    const indexed=titles.map((t,i)=>({title:typeof t==='string'?t:t,idx:i,pos:positions.get(i)??-1}));
    const found=indexed.filter(t=>t.pos>=0).sort((a,b)=>a.pos-b.pos);
    // Dedupe: two titles at same line → keep first
    const deduped=[];
    for(const t of found){
      if(deduped.length&&deduped[deduped.length-1].pos===t.pos)continue;
      deduped.push(t);
    }

    // Log title positions
    const totalDocWords=flat.map(l=>l.text).join(' ').split(/\s+/).length;
    console.log(`[Split] Document: ${flat.length} lines, ${totalDocWords} words, ${titles.length} titles requested, ${deduped.length} found`);
    const notFound=indexed.filter(t=>t.pos<0);
    if(notFound.length)console.warn(`[Split] Titles NOT FOUND: ${notFound.map(t=>'"'+t.title+'"').join(', ')}`);

    const sections=[];
    for(let i=0;i<deduped.length;i++){
      const start=deduped[i].pos;
      const end=i<deduped.length-1?deduped[i+1].pos:flat.length;
      if(end<=start){console.warn(`[Split] Skipping "${deduped[i].title}": start=${start} >= end=${end}`);continue;}
      const lines=flat.slice(start,end);
      const txt=lines.map(l=>l.text).join('\n');
      const words=txt.split(/\s+/).length;
      sections.push({
        title:deduped[i].title,text:txt,words,
        pageStart:lines[0]?.page||1,
        pageEnd:lines[lines.length-1]?.page||1,
        _end:end
      });
      console.log(`[Split] Section ${i+1}: "${deduped[i].title}" → lines ${start}-${end-1} (${words} words, pp.${lines[0]?.page||'?'}-${lines[lines.length-1]?.page||'?'})`);
    }

    // Validation
    const totalSecWords=sections.reduce((a,s)=>a+s.words,0);
    console.log(`[Split] Total: ${sections.length} sections, ${totalSecWords} words (doc has ${totalDocWords})`);
    if(totalSecWords>totalDocWords*1.1)console.error(`[Split] BUG: Section words (${totalSecWords}) EXCEED doc words (${totalDocWords}) by ${Math.round((totalSecWords/totalDocWords-1)*100)}%`);
    for(const s of sections){
      if(s.words>totalDocWords){
        console.error(`[Split] BUG: Section "${s.title}" has ${s.words} words — MORE than entire document (${totalDocWords})`);
      }
    }
    // Check no gaps or overlaps between consecutive sections
    for(let i=1;i<deduped.length;i++){
      const prevEnd=i>0&&sections[i-1]?sections[i-1]._end:0;
      const curStart=deduped[i].pos;
      if(curStart!==prevEnd&&sections[i-1])console.warn(`[Split] Gap between "${sections[i-1]?.title}" (ends at ${prevEnd}) and "${deduped[i].title}" (starts at ${curStart}): ${curStart-prevEnd} lines`);
    }
    return sections;
  };

  // ── Balance sections: merge small (<500 words), split large (>15000) ────
  const balanceSections=(sections)=>{
    const balanced=[];
    for(const s of sections){
      if(s.words<500&&balanced.length>0){
        const prev=balanced[balanced.length-1];
        prev.text+='\n\n'+s.text;prev.words+=s.words;prev.pageEnd=s.pageEnd;prev.title+=' / '+s.title;
      }else if(s.words>15000){
        const paras=s.text.split(/\n\n+/);let half='';let hw=0;
        for(const p of paras){half+=(half?'\n\n':'')+p;hw+=p.split(/\s+/).length;if(hw>=s.words/2)break;}
        const rest=s.text.slice(half.length).trim();
        balanced.push({...s,text:half,words:hw,title:s.title+' (1/2)'});
        if(rest.length>200)balanced.push({...s,text:rest,words:s.words-hw,title:s.title+' (2/2)',pageStart:s.pageStart+Math.round((s.pageEnd-s.pageStart)/2)});
      }else balanced.push(s);
    }
    return balanced.slice(0,25);
  };

  // ── Detect sections using bookmarks > font hierarchy > API fallback ─────
  const detectSections=async(pages,allBookmarks)=>{
    // Priority 1: Use PDF bookmarks if available (most reliable)
    if(allBookmarks?.length>=2&&allBookmarks.length<=25){
      const level1=allBookmarks.filter(b=>b.level===1);
      const titles=(level1.length>=2?level1:allBookmarks).slice(0,25).map(b=>b.title);
      const flat=pages.flatMap(p=>p.lines.map(l=>({text:l.text,page:p.pageNum})));
      const positions=findTitlePositions(flat,titles);
      const sections=splitTextAtTitles(flat,titles,positions);
      return balanceSections(sections);
    }

    // Priority 2: Font-based hierarchy
    // Step 1: Build font size histogram weighted by character count
    const fontSizes={};
    for(const page of pages)for(const line of page.lines){
      const k=Math.round(line.fontSize*10)/10; // round to 0.1
      fontSizes[k]=(fontSizes[k]||0)+line.text.length;
    }
    const sorted=Object.entries(fontSizes).sort((a,b)=>b[1]-a[1]);
    const bodyFS=parseFloat(sorted[0]?.[0])||12;
    // Find distinct larger font sizes (heading candidates)
    const largerSizes=sorted.map(([fs])=>parseFloat(fs)).filter(fs=>fs>bodyFS+0.5).sort((a,b)=>b-a);

    // Step 2: Classify heading levels
    // Level 1 = largest font or bold+largest — main sections
    // Level 2 = medium font or bold+medium — subsections (folded into level 1)
    const level1FS=largerSizes[0]||bodyFS+2;
    const level2FS=largerSizes[1]||largerSizes[0]||bodyFS+1;
    const allHeadings=[];
    for(const page of pages)for(const line of page.lines){
      if(line.text.length>120||line.text.length<2)continue;
      const fs=line.fontSize;
      const isL1=fs>=level1FS-0.3||(line.bold&&fs>bodyFS+1.5);
      const isL2=!isL1&&(fs>=level2FS-0.3||(line.bold&&fs>=bodyFS));
      if(isL1||isL2)allHeadings.push({text:line.text.trim(),page:page.pageNum,level:isL1?1:2,fontSize:fs,bold:line.bold});
    }

    // Step 3: Filter to level-1 only; dedupe
    const seen=new Set();
    let level1=allHeadings.filter(h=>h.level===1).filter(h=>{const n=h.text.toLowerCase();if(seen.has(n)||n.length<2)return false;seen.add(n);return true;});

    // If format detection found too few or too many, use API fallback
    const hasGoodFormat=level1.length>=2&&level1.length<=25;
    if(!hasGoodFormat){
      setProgress(prev=>({...prev,detail:'Consultando IA para detectar secciones principales...'}));
      const fullTextStr=pages.flatMap(p=>p.lines.map(l=>l.text)).join('\n');
      const sample=fullTextStr.slice(0,4000);
      try{
        const res=await fetch('/api/anthropic',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:2048,messages:[{role:'user',content:`Responde SOLO con JSON puro.\n\nIdentifica SOLO los títulos de SECCIÓN PRINCIPAL (no subsecciones) de este capítulo de libro médico. Máximo 15 secciones.\n\nTEXTO:\n${sample}\n\n{"sections":["titulo1","titulo2"]}`}]})});
        if(res.ok){
          const d=await res.json();
          let t=(d.content||[]).map(c=>c.text||'').join('').trim().replace(/```json|```/g,'');
          t=t.split('\n').filter(l=>!/^\s*#/.test(l)).join('\n').trim();
          const jIdx=t.indexOf('{');
          const parsed=JSON.parse(jIdx>=0?t.slice(jIdx):t);
          level1=(parsed.sections||[]).slice(0,25).map(s=>({text:typeof s==='string'?s:s.title||'',page:0,level:1}));
        }
      }catch{}
    }
    if(!level1.length)level1=[{text:'Capítulo completo',page:1,level:1}];

    // Step 4: Split text at level-1 titles using robust position finder
    const flat=pages.flatMap(p=>p.lines.map(l=>({text:l.text,page:p.pageNum})));
    const titles=level1.map(h=>h.text);
    const positions=findTitlePositions(flat,titles);
    const sections=splitTextAtTitles(flat,titles,positions);

    // Step 5: Enforce size bounds
    return balanceSections(sections);
  };

  // ── Process a PDF source ────────────────────────────────────────────────
  const processPdf=async(source)=>{
    const key=topicPdfKey(topic+'§'+source);
    const files=pdfMeta[key]||[];
    if(!files.length)return;
    setProcessing(source);setProgress({step:'Cargando PDFs...',pct:0,detail:`${files.length} archivo${files.length>1?'s':''}`});

    try{
      // Phase 1: Extract text from ALL PDFs of this source, sequentially
      const allPages=[];
      const allBookmarks=[];
      let totalPagesAll=0;
      for(let fi=0;fi<files.length;fi++){
        const f=files[fi];
        setProgress({step:`Extrayendo ${f.name} (${fi+1}/${files.length})...`,pct:Math.round(fi/files.length*75),detail:`${f.pages||'?'} páginas`});
        const blob=await idbLoad(topicFilePdfKey(topic+'§'+source,f.id));
        if(!blob){console.warn(`[PdfProc] PDF not found: ${f.name}`);continue;}
        const file=blob instanceof File?blob:new File([blob],f.name,{type:'application/pdf'});
        const{pages,totalPages,bookmarks}=await extractPdfText(file,f.name);
        // Offset page numbers to be sequential across files
        const offset=totalPagesAll;
        pages.forEach(p=>{p.pageNum+=offset;});
        allPages.push(...pages);
        if(bookmarks?.length&&!allBookmarks.length)allBookmarks.push(...bookmarks); // use bookmarks from first PDF that has them
        totalPagesAll+=totalPages;
      }

      if(!allPages.length)throw new Error('No se pudo extraer texto de ningún PDF');

      // Save raw text to IndexedDB for later content extraction
      const rawFullText=allPages.flatMap(p=>p.lines.map(l=>l.text)).join('\n');
      const rawTextKey=`raw_text_${source}_${topic.replace(/[^a-z0-9]/gi,'').slice(0,30)}`;
      await idbSave(rawTextKey,rawFullText);
      console.log(`[PdfProc] Saved raw text: ${rawTextKey} (${rawFullText.split(/\s+/).length} words)`);

      // Phase 2: Detect sections on unified text
      setProgress({step:'Detectando secciones en texto unificado...',pct:80,detail:`${totalPagesAll} páginas totales de ${files.length} archivo${files.length>1?'s':''}`});
      const rawSections=await detectSections(allPages,allBookmarks);

      // Phase 3: One API call to refine titles
      setProgress({step:'Refinando títulos con IA...',pct:90,detail:`${rawSections.length} secciones detectadas`});
      const summary=rawSections.map(s=>`"${s.title}" (${s.text.slice(0,120).replace(/\n/g,' ')}...)`).join('\n');
      try{
        const res=await fetch('/api/anthropic',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:2048,messages:[{role:'user',content:`Responde SOLO con JSON puro, sin markdown.\n\nSecciones de un capítulo de "${topic}" (${source==='tietz'?'Tietz':'Henry'}). Refina títulos al español.\n\n${summary}\n\n{"titles":[${rawSections.map(()=>'"título"').join(',')}]}`}]})});
        if(res.ok){
          const d=await res.json();
          const text=(d.content||[]).map(c=>c.text||'').join('').trim().replace(/```json|```/g,'');
          const cleaned=text.split('\n').filter(l=>!/^\s*#/.test(l)).join('\n').trim();
          const jIdx=cleaned.indexOf('{');
          try{const parsed=JSON.parse(jIdx>=0?cleaned.slice(jIdx):cleaned);(parsed.titles||[]).forEach((t,i)=>{if(t&&rawSections[i])rawSections[i].title=t;});}catch{}
        }
      }catch{}

      setProgress({step:'Listo para revisar',pct:100,detail:`${rawSections.length} secciones · ${totalPagesAll} páginas · ${files.length} PDFs`});
      setEditingSections(rawSections.map(s=>({title:s.title,text:s.text,pageStart:s.pageStart,pageEnd:s.pageEnd,words:s.text.split(/\s+/).length})));
      setEditSource(source);
    }catch(e){
      setProgress({step:`Error: ${e.message}`,pct:0,detail:''});
    }
    setProcessing(null);
  };

  // ── Confirm sections and save ───────────────────────────────────────────
  const confirmSections=async()=>{
    if(!editingSections||!editSource)return;
    const sourceLabel=editSource==='ambos'?'Tietz+Henry':editSource==='tietz'?'Tietz':'Henry';

    // 1. Save raw extraction to localStorage for persistence
    const result={sections:editingSections,processedAt:new Date().toISOString()};
    const newPdfData={...pdfData,[editSource]:result};
    setPdfData(newPdfData);save(storeKey,newPdfData);

    // 2. Build the learning data with proper merge logic
    const existingData=learning||{sections:[]};
    const existingSections=[...(existingData.sections||[])];
    const existingByTitle=new Map(existingSections.map((s,i)=>[s.title,i]));
    let created=0,merged=0,skipped=0;

    for(const sec of editingSections){
      if(sec.text.trim().length<50)continue; // skip tiny fragments
      const taggedText=`[Fuente: ${sourceLabel}]\n\n${sec.text}`;
      const existingIdx=existingByTitle.get(sec.title);

      if(existingIdx!=null){
        // Section exists — check if this source is already there
        const existing=existingSections[existingIdx];
        if(existing.text.includes(`[Fuente: ${sourceLabel}]`)){
          // Same source already merged — ask to overwrite
          if(confirm(`La sección "${sec.title}" ya tiene contenido de ${sourceLabel}. ¿Sobreescribir?`)){
            // Replace the source block
            const otherSource=sourceLabel==='Tietz'?'Henry':'Tietz';
            const otherMatch=existing.text.match(new RegExp(`\\[Fuente: ${otherSource}\\][\\s\\S]*`));
            existingSections[existingIdx]={...existing,text:taggedText+(otherMatch?'\n\n'+otherMatch[0]:''),generated:null};
            merged++;
          }else{skipped++;}
        }else{
          // Different source — append
          existingSections[existingIdx]={...existing,text:existing.text+'\n\n'+taggedText,generated:null};
          merged++;
        }
      }else{
        // New section
        const newSec={id:uid(),title:sec.title,text:taggedText,generated:null,pageStart:sec.pageStart,pageEnd:sec.pageEnd};
        existingSections.push(newSec);
        existingByTitle.set(sec.title,existingSections.length-1);
        created++;
      }
    }

    // 3. Save to IndexedDB via saveLearningData (updates React state + persists)
    await saveLearningData(topic,{...existingData,sections:existingSections});

    // 4. Clear editing state and show result
    setEditingSections(null);setEditSource(null);
    setProgress({step:`✓ ${created} creadas · ${merged} fusionadas · ${skipped} omitidas`,pct:100,detail:`Secciones listas en Aprendizaje`});
  };

  /* OLD API-based code removed — replaced by local pdf.js extraction above */
  if(false){const _x_cleanRaw=(raw)=>{
    let s=raw.trim();
    s=s.replace(/```(?:json)?\s*/gi,'').replace(/```\s*/g,'');
    s=s.split('\n').filter(l=>!/^\s*#{1,6}\s/.test(l)).join('\n').trim();
    const fb=s.indexOf('{'),fb2=s.indexOf('[');
    const js=fb>=0&&fb2>=0?Math.min(fb,fb2):fb>=0?fb:fb2;
    if(js>0)s=s.slice(js);
    return s;
  };
  const safeParse=(raw,ctx)=>{
    const c=cleanRaw(raw);
    try{return JSON.parse(c);}catch{
      try{return JSON.parse(repairJSON(c));}catch{
        const preview=c.slice(0,300).replace(/\n/g,'\\n');
        throw new Error(`JSON parse failed (${ctx}). Preview: "${preview}"`);
      }
    }
  };
  const JSON_HINT='Responde ÚNICAMENTE con JSON puro. Sin markdown, sin backticks, sin #, sin texto antes o después del JSON.';

  const delay=ms=>new Promise(r=>setTimeout(r,ms));

  const callClaude=async(prompt,maxTokens=2048,retries=3)=>{
    for(let a=1;a<=retries;a++){
      try{
        const res=await fetch('/api/anthropic',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:maxTokens,messages:[{role:'user',content:prompt}]})});
        if(!res.ok){
          if(res.status===429&&a<retries){
            addLog(`⏳ Rate limit — esperando 15s antes de reintentar (intento ${a}/${retries})...`);
            setProgress(p=>({...p,detail:'Rate limit detectado — esperando 15s antes de continuar...'}));
            await delay(15000);continue;
          }
          if(a<retries&&res.status>=500){await delay(a*5000);continue;}
          throw new Error(`HTTP ${res.status}`);
        }
        const r=await res.json();
        return(r.content||[]).map(c=>c.text||'').join('').trim();
      }catch(e){
        if(a>=retries)throw e;
        addLog(`⚠ Error intento ${a}: ${e.message}. Reintentando en ${a*5}s...`);
        await delay(a*5000);
      }
    }
  };

  const callClaudeWithDoc=async(content,maxTokens=4096,retries=3)=>{
    for(let a=1;a<=retries;a++){
      try{
        const res=await fetch('/api/anthropic',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:maxTokens,messages:[{role:'user',content}]})});
        if(!res.ok){
          if(res.status===429&&a<retries){
            addLog(`⏳ Rate limit — esperando 15s antes de reintentar (intento ${a}/${retries})...`);
            setProgress(p=>({...p,detail:'Rate limit detectado — esperando 15s antes de continuar...'}));
            await delay(15000);continue;
          }
          if(a<retries&&res.status>=500){await delay(a*5000);continue;}
          throw new Error(`HTTP ${res.status}`);
        }
        const r=await res.json();
        return(r.content||[]).map(c=>c.text||'').join('').trim();
      }catch(e){
        if(a>=retries)throw e;
        addLog(`⚠ Error intento ${a}: ${e.message}. Reintentando en ${a*5}s...`);
        await delay(a*5000);
      }
    }
  };

  // Split text into paragraph chunks of ~300 words
  const chunkText=(text,targetWords=300)=>{
    const paras=text.split(/\n\s*\n/).filter(p=>p.trim());
    const chunks=[];let cur=[];let cw=0;
    for(const p of paras){
      const wc=p.trim().split(/\s+/).length;
      if(cw+wc>targetWords&&cur.length>0){chunks.push(cur.join('\n\n'));cur=[p];cw=wc;}
      else{cur.push(p);cw+=wc;}
    }
    if(cur.length)chunks.push(cur.join('\n\n'));
    return chunks;
  };

  const processPdf=async(source)=>{
    const key=topicPdfKey(topic+'§'+source);
    const files=pdfMeta[key]||[];
    if(!files.length)return;
    setProcessing(source);setProgress({step:'Cargando PDF...',pct:0,detail:'',log:[]});

    try{
      // Load PDF and convert to base64
      const blob=await idbLoad(topicFilePdfKey(topic+'§'+source,files[0].id));
      if(!blob)throw new Error('PDF no encontrado');
      const b64=await blobToB64(blob instanceof File?blob:new File([blob],files[0].name,{type:'application/pdf'}));
      addLog(`✓ PDF cargado: ${files[0].name}`);

      // Phase 1: Extract structure
      setProgress(p=>({...p,step:'Fase 1: Extrayendo estructura...',pct:5}));
      addLog('Fase 1: Extrayendo índice de secciones...');
      const structRaw=await callClaudeWithDoc([
        {type:'document',source:{type:'base64',media_type:'application/pdf',data:b64}},
        {type:'text',text:`${JSON_HINT}\n\nIDIOMA: Todo en español. Analiza este documento de "${topic}". Identifica TODAS las secciones del capítulo.\n\n{"sections":[{"title":"Título en español","pageHint":"página aprox"}]}\n\n5-15 secciones.`}
      ],4096);
      const struct=safeParse(structRaw,'extract_structure');
      const secs=struct.sections||struct;
      addLog(`✓ ${secs.length} secciones detectadas`);

      // Phase 2: Extract full text (delay to avoid rate limit after Phase 1)
      await delay(2000);
      setProgress(p=>({...p,step:'Fase 2: Extrayendo texto...',pct:10}));
      addLog('Fase 2: Extrayendo texto del PDF...');
      const textRaw=await callClaudeWithDoc([
        {type:'document',source:{type:'base64',media_type:'application/pdf',data:b64}},
        {type:'text',text:`Extrae el texto COMPLETO de este documento, párrafo por párrafo. No resumas ni omitas nada. Devuelve todo el texto tal cual. Máximo detalle.`}
      ],16000);
      addLog(`✓ Texto extraído: ${textRaw.length} caracteres`);

      // Phase 3: Chunk and extract per paragraph group
      const chunks=chunkText(textRaw,300);
      const totalChunks=chunks.length;
      addLog(`Fase 3: ${totalChunks} bloques de párrafos a procesar`);
      const allExtracts=[];
      const failed=[];

      for(let i=0;i<totalChunks;i++){
        // 5s delay between chunks to respect rate limits
        if(i>0){
          setProgress(p=>({...p,detail:`Esperando 5s antes del bloque ${i+1}...`}));
          await delay(5000);
        }
        const secGuess=secs[Math.min(Math.floor(i/totalChunks*secs.length),secs.length-1)]?.title||'General';
        setProgress(p=>({...p,step:`Fase 3: Bloque ${i+1}/${totalChunks}`,pct:15+Math.round(i/totalChunks*60),detail:`Sección: ${secGuess}`}));
        try{
          const raw=await callClaude(`${JSON_HINT}\n\nExperto bioquímica clínica. IDIOMA: español. Extrae TODA la información SIN resumir.\n\nTEMA:"${topic}" SECCIÓN:"${secGuess}"\n\n${chunks[i]}\n\n{"concepts":[{"t":"nombre","d":"definición completa","cat":"concept|value|mechanism|clinical"}]}`,2048);
          const parsed=safeParse(raw,`chunk_${i+1}`);
          allExtracts.push({section:secGuess,data:parsed.concepts||parsed,chunkIdx:i});
          addLog(`✓ Bloque ${i+1}: ${(parsed.concepts||parsed).length||0} conceptos`);
        }catch(e){
          failed.push(i);
          addLog(`✗ Bloque ${i+1}: ${e.message}`);
        }
      }

      // Save result
      const result={sections:secs,extracts:allExtracts,failed,processedAt:new Date().toISOString(),totalChunks,textLength:textRaw.length};
      const newPdfData={...pdfData,[source]:result};
      setPdfData(newPdfData);
      save('olab_pdfproc_'+topic.replace(/[^a-z0-9]/gi,'').slice(0,30),newPdfData);
      addLog(`✓ ${source.toUpperCase()} completado. ${allExtracts.length}/${totalChunks} bloques OK.${failed.length?` ${failed.length} fallidos.`:''}`);
      setProgress(p=>({...p,step:'Completado',pct:100}));
    }catch(e){addLog(`ERROR: ${e.message}`);}
    setProcessing(null);
  };

  // Phase 4+5: Fuse and create sections
  const fuseAndCreate=async()=>{
    if(!pdfData.tietz&&!pdfData.henry)return;
    setProcessing('fuse');setProgress({step:'Fusionando fuentes...',pct:0,detail:'',log:[]});

    try{
      const source=pdfData.tietz||pdfData.henry;
      const secs=source.sections||[];
      const fusedSections=[];

      for(let i=0;i<secs.length;i++){
        if(i>0)await delay(5000);
        const secTitle=secs[i].title;
        setProgress(p=>({...p,step:`Fusionando sección ${i+1}/${secs.length}: ${secTitle}`,pct:Math.round(i/secs.length*80)}));
        const tietzConcepts=pdfData.tietz?.extracts?.filter(e=>e.section===secTitle).flatMap(e=>e.data)||[];
        const henryConcepts=pdfData.henry?.extracts?.filter(e=>e.section===secTitle).flatMap(e=>e.data)||[];

        let fusedContent;
        if(tietzConcepts.length&&henryConcepts.length){
          addLog(`Fusionando "${secTitle}": Tietz(${tietzConcepts.length}) + Henry(${henryConcepts.length})`);
          const raw=await callClaude(`${JSON_HINT}\n\nExperto bioquímica clínica. IDIOMA: español. Fusiona contenido de Tietz y Henry para "${secTitle}".\n\nTIETZ:\n${JSON.stringify(tietzConcepts.slice(0,40))}\n\nHENRY:\n${JSON.stringify(henryConcepts.slice(0,40))}\n\nElimina duplicados, conserva variaciones.\n\n{"concepts":[{"t":"...","d":"...","source":"tietz|henry|ambos"}]}`,4096);
          fusedContent=safeParse(raw,`fuse_${secTitle}`);
        }else{
          fusedContent={concepts:tietzConcepts.length?tietzConcepts:henryConcepts};
        }
        fusedSections.push({title:secTitle,concepts:fusedContent.concepts||fusedContent});
        addLog(`✓ ${secTitle}: ${(fusedContent.concepts||[]).length} conceptos fusionados`);
      }

      // Phase 5: Create sections in Aprendizaje
      setProgress(p=>({...p,step:'Creando secciones en Aprendizaje...',pct:90}));
      const existingData=learning||{sections:[]};
      const existingTitles=new Set((existingData.sections||[]).map(s=>s.title));
      const newSections=fusedSections.filter(s=>!existingTitles.has(s.title)).map(s=>({
        id:uid(),
        title:s.title,
        text:s.concepts.map(c=>`${c.t}: ${c.d}`).join('\n\n'),
        generated:null
      }));

      if(newSections.length){
        const updated={...existingData,sections:[...(existingData.sections||[]),...newSections]};
        await saveLearningData(topic,updated);
        addLog(`✓ ${newSections.length} secciones creadas en Aprendizaje`);
      }else{
        addLog('Las secciones ya existían en Aprendizaje');
      }

      // Save fused data
      const newPdfData={...pdfData,fused:fusedSections};
      setPdfData(newPdfData);
      save('olab_pdfproc_'+topic.replace(/[^a-z0-9]/gi,'').slice(0,30),newPdfData);
      setProgress(p=>({...p,step:'Completado',pct:100}));
    }catch(e){addLog(`ERROR: ${e.message}`);}
    setProcessing(null);
  };} /* END dead code block */

  const tietzDone=!!pdfData.tietz;
  const henryDone=!!pdfData.henry;
  const hasTietzPdf=(pdfMeta[topicPdfKey(topic+'§tietz')]||[]).length>0;
  const hasHenryPdf=(pdfMeta[topicPdfKey(topic+'§henry')]||[]).length>0;

  // Check if raw text is stored in IndexedDB
  const [rawTextInfo,setRawTextInfo]=useState({tietz:null,henry:null});
  useEffect(()=>{
    const checkRaw=async()=>{
      const slug=topic.replace(/[^a-z0-9]/gi,'').slice(0,30);
      const t=await idbLoad(`raw_text_tietz_${slug}`);
      const h=await idbLoad(`raw_text_henry_${slug}`);
      setRawTextInfo({
        tietz:t?{words:typeof t==='string'?t.split(/\s+/).length:0}:null,
        henry:h?{words:typeof h==='string'?h.split(/\s+/).length:0}:null
      });
    };
    checkRaw();
  },[topic,tietzDone,henryDone]);

  // ── Manual structure editor ──────────────────────────────────────────────
  const parseIndexText=(text)=>{
    const lines=text.split('\n').filter(l=>l.trim());
    return lines.map(line=>{
      // Detect level by: leading whitespace, numbered prefix, or tab depth
      const stripped=line.replace(/^\s+/,'');
      const indent=line.length-stripped.length;
      const tabLevel=Math.floor(indent/2);
      // Check numbered prefix: 1.1.1 → level 3, 1.1 → level 2, 1. → level 1
      const numMatch=stripped.match(/^(\d+(?:\.\d+)*)[.\)]\s*/);
      let level=1;
      if(numMatch)level=numMatch[1].split('.').length;
      else if(tabLevel>0)level=Math.min(tabLevel+1,3);
      const title=stripped.replace(/^[\d.)\-–—•·\s]+/,'').trim()||stripped.trim();
      return{id:uid(),title,level:Math.min(level,3)};
    }).filter(n=>n.title.length>1);
  };

  const applyManualText=()=>{
    const nodes=parseIndexText(manualText);
    if(!nodes.length)return;
    setTreeNodes(nodes);
  };

  const addNodeAfter=(idx)=>{
    const n=[...treeNodes];
    const level=n[idx]?.level||1;
    n.splice(idx+1,0,{id:uid(),title:'Nueva sección',level});
    setTreeNodes(n);setEditingNodeId(n[idx+1].id);
  };

  const addChild=(idx)=>{
    const n=[...treeNodes];
    const parentLevel=n[idx]?.level||1;
    n.splice(idx+1,0,{id:uid(),title:'Nueva subsección',level:Math.min(parentLevel+1,3)});
    setTreeNodes(n);setEditingNodeId(n[idx+1].id);
  };

  const removeNode=(idx)=>{setTreeNodes(treeNodes.filter((_,i)=>i!==idx));};

  const mergeWithNext=(idx)=>{
    if(idx>=treeNodes.length-1)return;
    const n=[...treeNodes];
    n[idx]={...n[idx],title:n[idx].title+' / '+n[idx+1].title};
    n.splice(idx+1,1);
    setTreeNodes(n);
  };

  const moveNode=(fromIdx,toIdx)=>{
    if(fromIdx===toIdx)return;
    const n=[...treeNodes];const[moved]=n.splice(fromIdx,1);n.splice(toIdx,0,moved);
    setTreeNodes(n);
  };

  const changeLevel=(idx,delta)=>{
    const n=[...treeNodes];
    n[idx]={...n[idx],level:Math.max(1,Math.min(3,n[idx].level+delta))};
    setTreeNodes(n);
  };

  // Apply tree structure to extracted PDF text and create sections
  const applyTreeToText=async(source)=>{
    const mainSections=treeNodes.filter(n=>n.level===1);
    if(!mainSections.length){alert('Define al menos una sección de nivel 1.');return;}

    const pdfResult=pdfData[source];
    if(!pdfResult?.sections){alert(`Primero extrae el PDF de ${source==='tietz'?'Tietz':'Henry'}.`);return;}

    // Build flat line array from extracted PDF pages
    const fullText=pdfResult.sections.map(s=>s.text).join('\n\n');
    const flat=fullText.split('\n').map((text,i)=>({text,page:0}));

    // Use shared functions: find positions, then split
    const titles=mainSections.map(n=>n.title);
    const positions=findTitlePositions(flat,titles);
    const rawSections=splitTextAtTitles(flat,titles,positions);

    // Attach subsection info from tree
    const sections=rawSections.map(sec=>{
      const mainNode=treeNodes.find(n=>n.level===1&&n.title===sec.title);
      const mainIdx=mainNode?treeNodes.indexOf(mainNode):-1;
      const nextMainIdx=mainIdx>=0?treeNodes.findIndex((n,i)=>i>mainIdx&&n.level===1):-1;
      const subsections=mainIdx>=0?treeNodes.slice(mainIdx+1,nextMainIdx>0?nextMainIdx:treeNodes.length).filter(n=>n.level>1):[];
      return{...sec,subsectionTitles:subsections.map(s=>s.title)};
    });

    setEditingSections(sections);
    setEditSource(source);
    setManualMode(false);
  };

  // Apply Tietz structure as template for Henry
  const applyAsTemplate=(fromSource,toSource)=>{
    const fromData=pdfData[fromSource];
    if(!fromData?.sections)return;
    const titles=fromData.sections.map(s=>s.title);
    const nodes=titles.map(t=>({id:uid(),title:t,level:1}));
    setTreeNodes(nodes);
  };

  // ── Manual editor UI ──────────────────────────────────────────────────
  if(manualMode) return(
    <Card style={{padding:'16px 18px',marginBottom:16}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <div style={{fontSize:13,fontWeight:700,color:T.text}}>📋 Editor manual de estructura</div>
        <button onClick={()=>setManualMode(false)} style={{fontSize:11,background:'none',border:`0.5px solid ${T.border}`,borderRadius:6,padding:'4px 10px',cursor:'pointer',color:T.muted,fontFamily:FONT}}>Cancelar</button>
      </div>

      {!treeNodes.length?(
        <div>
          <div style={{fontSize:11,color:T.dim,marginBottom:8,lineHeight:1.5}}>Pega el índice del capítulo. Usa indentación o numeración (1., 1.1, 1.1.1) para indicar jerarquía.</div>
          <textarea value={manualText} onChange={e=>setManualText(e.target.value)} placeholder={"1. Introducción\n2. Fisiología\n  2.1 Metabolismo\n  2.2 Regulación\n3. Métodos analíticos\n  3.1 Espectrofotometría\n  3.2 Inmunoanálisis\n4. Valores de referencia\n5. Patología\n  5.1 Diagnóstico diferencial"}
            style={{width:'100%',minHeight:160,background:T.bg,color:T.text,border:`0.5px solid ${T.border}`,borderRadius:8,padding:'10px 12px',fontSize:12,fontFamily:'monospace',resize:'vertical',outline:'none',boxSizing:'border-box',lineHeight:1.6,marginBottom:10}}/>
          <div style={{display:'flex',gap:6}}>
            <button onClick={applyManualText} disabled={!manualText.trim()} style={{background:manualText.trim()?T.green:T.surface,color:manualText.trim()?'#000':T.dim,border:`0.5px solid ${manualText.trim()?T.green:T.border}`,borderRadius:8,padding:'6px 16px',fontSize:12,fontWeight:700,cursor:manualText.trim()?'pointer':'not-allowed',fontFamily:FONT}}>Crear árbol</button>
            {pdfData.tietz&&<button onClick={()=>applyAsTemplate('tietz','henry')} style={{fontSize:11,background:T.blueS,border:`0.5px solid ${T.blue}`,borderRadius:6,padding:'4px 10px',cursor:'pointer',color:T.blueText,fontFamily:FONT}}>📘 Usar estructura Tietz</button>}
            {pdfData.henry&&<button onClick={()=>applyAsTemplate('henry','tietz')} style={{fontSize:11,background:T.amberS,border:`0.5px solid ${T.amber}`,borderRadius:6,padding:'4px 10px',cursor:'pointer',color:T.amberText,fontFamily:FONT}}>📙 Usar estructura Henry</button>}
          </div>
        </div>
      ):(
        <div>
          <div style={{fontSize:10,color:T.dim,marginBottom:8}}>Arrastra para reordenar. ◀▶ para cambiar nivel. Doble clic para editar título.</div>
          {/* Tree view */}
          <div style={{display:'flex',flexDirection:'column',gap:2,marginBottom:12}}>
            {treeNodes.map((node,i)=>(
              <div key={node.id} draggable
                onDragStart={()=>setDragNode(i)} onDragEnd={()=>setDragNode(null)}
                onDragOver={e=>e.preventDefault()}
                onDrop={()=>{if(dragNode!==null)moveNode(dragNode,i);setDragNode(null);}}
                style={{display:'flex',alignItems:'center',gap:4,padding:'4px 6px',paddingLeft:8+(node.level-1)*20,background:dragNode===i?T.tealS:T.bg,borderRadius:6,border:`0.5px solid ${T.border}`,opacity:dragNode===i?0.5:1,cursor:'grab'}}>
                <span style={{fontSize:8,color:T.dim,fontWeight:700,minWidth:10}}>L{node.level}</span>
                <button onClick={()=>changeLevel(i,-1)} disabled={node.level<=1} style={{background:'none',border:'none',color:node.level>1?T.teal:T.dim,cursor:node.level>1?'pointer':'default',fontSize:10,padding:'0 2px'}}>◀</button>
                <button onClick={()=>changeLevel(i,1)} disabled={node.level>=3} style={{background:'none',border:'none',color:node.level<3?T.teal:T.dim,cursor:node.level<3?'pointer':'default',fontSize:10,padding:'0 2px'}}>▶</button>
                {editingNodeId===node.id?(
                  <input value={node.title} autoFocus onChange={e=>{const n=[...treeNodes];n[i]={...n[i],title:e.target.value};setTreeNodes(n);}}
                    onBlur={()=>setEditingNodeId(null)} onKeyDown={e=>e.key==='Enter'&&setEditingNodeId(null)}
                    style={{flex:1,background:'transparent',color:T.text,border:`0.5px solid ${T.teal}`,borderRadius:4,padding:'2px 6px',fontSize:11,fontWeight:600,outline:'none',fontFamily:FONT}}/>
                ):(
                  <span onDoubleClick={()=>setEditingNodeId(node.id)} style={{flex:1,fontSize:11,fontWeight:node.level===1?700:500,color:node.level===1?T.text:T.muted,cursor:'text'}}>{node.title}</span>
                )}
                <button onClick={()=>addChild(i)} title="Añadir subsección" style={{background:'none',border:'none',color:T.teal,cursor:'pointer',fontSize:10,padding:'0 2px'}}>+↓</button>
                <button onClick={()=>addNodeAfter(i)} title="Añadir sección después" style={{background:'none',border:'none',color:T.green,cursor:'pointer',fontSize:10,padding:'0 2px'}}>+</button>
                {i<treeNodes.length-1&&<button onClick={()=>mergeWithNext(i)} title="Fusionar con siguiente" style={{background:'none',border:'none',color:T.amber,cursor:'pointer',fontSize:10,padding:'0 2px'}}>⊕</button>}
                <button onClick={()=>removeNode(i)} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:10,padding:'0 2px'}}>×</button>
              </div>
            ))}
          </div>
          <div style={{fontSize:10,color:T.dim,marginBottom:8}}>{treeNodes.filter(n=>n.level===1).length} secciones principales · {treeNodes.filter(n=>n.level>1).length} subsecciones</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            <button onClick={async()=>{
              // Create sections directly in Aprendizaje — empty, ready for content extraction
              const mainNodes=treeNodes.filter(n=>n.level===1);
              if(!mainNodes.length){alert('Define al menos una sección de nivel 1.');return;}
              const existingData=learning||{sections:[]};
              const existingTitles=new Set((existingData.sections||[]).map(s=>s.title));
              const newSections=[];
              for(const node of mainNodes){
                if(existingTitles.has(node.title))continue;
                // Collect subsection titles for this main section
                const nodeIdx=treeNodes.indexOf(node);
                const nextMainIdx=treeNodes.findIndex((n,i)=>i>nodeIdx&&n.level===1);
                const subs=treeNodes.slice(nodeIdx+1,nextMainIdx>0?nextMainIdx:treeNodes.length).filter(n=>n.level>1);
                newSections.push({
                  id:uid(),title:node.title,text:'',generated:null,extractedContent:null,
                  subsections:subs.length?subs.map(s=>({id:uid(),title:s.title,text:'',generated:null})):undefined
                });
              }
              if(newSections.length){
                await saveLearningData(topic,{...existingData,sections:[...(existingData.sections||[]),...newSections]});
              }
              setManualMode(false);setTreeNodes([]);
              setProgress({step:`✓ ${newSections.length} secciones creadas. Pega el texto de cada sección manualmente.`,pct:100,detail:''});
            }}
              style={{background:T.green,color:'#fff',border:'none',borderRadius:8,padding:'6px 18px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:FONT}}>
              ✓ Confirmar estructura
            </button>
            <button onClick={()=>setTreeNodes([])} style={{fontSize:11,background:'none',border:`0.5px solid ${T.border}`,borderRadius:6,padding:'4px 10px',cursor:'pointer',color:T.muted,fontFamily:FONT}}>Reiniciar</button>
          </div>
        </div>
      )}
    </Card>
  );

  // Split a section at a manual point
  const splitSection=(idx)=>{
    const sec=editingSections[idx];
    const paras=sec.text.split(/\n\n+/);
    const mid=Math.ceil(paras.length/2);
    const textA=paras.slice(0,mid).join('\n\n');
    const textB=paras.slice(mid).join('\n\n');
    const wordsA=textA.split(/\s+/).length;
    const wordsB=textB.split(/\s+/).length;
    const midPage=sec.pageStart+Math.round((sec.pageEnd-sec.pageStart)/2);
    const newSections=[...editingSections];
    newSections.splice(idx,1,
      {...sec,text:textA,words:wordsA,title:sec.title+' (1/2)',pageEnd:midPage},
      {...sec,text:textB,words:wordsB,title:sec.title+' (2/2)',pageStart:midPage}
    );
    setEditingSections(newSections);
  };

  // Merge two adjacent sections
  const mergeSections=(idx,direction)=>{
    const targetIdx=direction==='prev'?idx-1:idx+1;
    if(targetIdx<0||targetIdx>=editingSections.length)return;
    const n=[...editingSections];
    const a=n[Math.min(idx,targetIdx)],b=n[Math.max(idx,targetIdx)];
    const merged={...a,title:a.title+' / '+b.title,text:a.text+'\n\n'+b.text,words:a.words+b.words,pageEnd:Math.max(a.pageEnd||0,b.pageEnd||0)};
    n.splice(Math.min(idx,targetIdx),2,merged);
    setEditingSections(n);
  };

  // Size validation by level
  const getSizeStatus=(words,level)=>{
    const ranges={1:{min:5000,max:20000},2:{min:2000,max:8000},3:{min:500,max:3000}};
    const r=ranges[level||1]||ranges[1];
    if(words<300)return{color:T.red,label:'Muy corta',status:'red'};
    if(words>20000)return{color:T.red,label:'Muy larga',status:'red'};
    if(words<r.min)return{color:T.amber,label:'Corta',status:'yellow'};
    if(words>r.max)return{color:T.amber,label:'Larga',status:'yellow'};
    return{color:T.green,label:'Óptima',status:'green'};
  };

  // Section review/edit screen with validation
  if(editingSections) {
    const maxWords=Math.max(...editingSections.map(s=>s.words),1);
    const totalWords=editingSections.reduce((a,s)=>a+s.words,0);
    const avgWords=Math.round(totalWords/editingSections.length);
    const redSections=editingSections.filter(s=>{const st=getSizeStatus(s.words,s.level||1);return st.status==='red';});
    return(
    <Card style={{padding:'16px 18px',marginBottom:16}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <div style={{fontSize:13,fontWeight:700,color:T.text}}>{editingSections.length} secciones — {editSource==='ambos'?'📘📙 Tietz + Henry':editSource==='tietz'?'📘 Tietz':'📙 Henry'}</div>
        <div style={{display:'flex',gap:6}}>
          <button onClick={()=>{setEditingSections(null);setEditSource(null);}} style={{fontSize:11,background:'none',border:`0.5px solid ${T.border}`,borderRadius:6,padding:'4px 10px',cursor:'pointer',color:T.muted,fontFamily:FONT}}>Cancelar</button>
          <button onClick={confirmSections} style={{fontSize:11,background:T.green,color:'#fff',border:'none',borderRadius:6,padding:'4px 14px',cursor:'pointer',fontWeight:700,fontFamily:FONT}}>✓ Confirmar</button>
        </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:3,marginBottom:10}}>
        {editingSections.map((sec,i)=>{
          const pct=Math.round(sec.words/maxWords*100);
          const sz=getSizeStatus(sec.words,sec.level||1);
          const isVerySmall=sec.words<300;
          const isVeryBig=sec.words>20000;
          return(
            <div key={i} style={{background:T.bg,borderRadius:6,border:`0.5px solid ${sz.status==='red'?sz.color:sz.status==='yellow'?sz.color:T.border}`,overflow:'hidden'}}>
              <div style={{display:'flex',alignItems:'center',gap:4,padding:'5px 8px'}}>
                <span style={{fontSize:9,color:T.dim,fontWeight:700,minWidth:14}}>{i+1}</span>
                <input value={sec.title} onChange={e=>{const n=[...editingSections];n[i]={...n[i],title:e.target.value};setEditingSections(n);}}
                  style={{flex:1,background:'transparent',color:T.text,border:'none',fontSize:11,fontWeight:600,outline:'none',fontFamily:FONT,minWidth:0}}/>
                <span style={{fontSize:8,color:sz.color,fontWeight:700,flexShrink:0,background:sz.color+'18',padding:'1px 4px',borderRadius:3}}>{sec.words.toLocaleString()} · {sz.label}</span>
                <span style={{fontSize:8,color:T.dim,flexShrink:0}}>pp.{sec.pageStart||'?'}-{sec.pageEnd||'?'}</span>
                {isVeryBig&&<button onClick={()=>splitSection(i)} title="Dividir" style={{background:T.redS,border:`0.5px solid ${T.red}`,borderRadius:4,padding:'1px 5px',fontSize:8,cursor:'pointer',color:T.red,fontWeight:700,fontFamily:FONT}}>✂</button>}
                {isVerySmall&&i>0&&<button onClick={()=>mergeSections(i,'prev')} title="Fusionar con anterior" style={{background:T.amberS,border:`0.5px solid ${T.amber}`,borderRadius:4,padding:'1px 5px',fontSize:8,cursor:'pointer',color:T.amberText,fontWeight:700,fontFamily:FONT}}>←⊕</button>}
                {isVerySmall&&i<editingSections.length-1&&<button onClick={()=>mergeSections(i,'next')} title="Fusionar con siguiente" style={{background:T.amberS,border:`0.5px solid ${T.amber}`,borderRadius:4,padding:'1px 5px',fontSize:8,cursor:'pointer',color:T.amberText,fontWeight:700,fontFamily:FONT}}>⊕→</button>}
                <button onClick={()=>setEditingSections(editingSections.filter((_,j)=>j!==i))} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:10,padding:'0 2px'}}>×</button>
              </div>
              <div style={{height:3,background:T.border}}><div style={{height:'100%',width:`${pct}%`,background:sz.color,borderRadius:2}}/></div>
            </div>
          );
        })}
      </div>
      {/* Summary */}
      <div style={{padding:'8px 10px',background:T.surface,borderRadius:6,border:`0.5px solid ${T.border}`,fontSize:10,color:T.dim,display:'flex',gap:12,flexWrap:'wrap'}}>
        <span>{editingSections.length} secciones</span>
        <span>{totalWords.toLocaleString()} palabras totales</span>
        <span>Media: {avgWords.toLocaleString()} pal/sec</span>
        {redSections.length>0&&<span style={{color:T.red,fontWeight:700}}>⚠ {redSections.length} secciones necesitan atención</span>}
        {redSections.length===0&&<span style={{color:T.green}}>✓ Todas las secciones en rango aceptable</span>}
      </div>
    </Card>
  );}

  return(
    <Card style={{padding:'14px 18px',marginBottom:16}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
        <div style={{fontSize:12,fontWeight:700,color:T.text}}>📄 Extracción de PDFs</div>
        <button onClick={()=>setManualMode(true)} style={{fontSize:10,background:'none',border:`0.5px solid ${T.border}`,borderRadius:6,padding:'3px 10px',cursor:'pointer',color:T.muted,fontFamily:FONT}}>📋 Estructura manual</button>
      </div>
      <div style={{display:'flex',gap:8,marginBottom:10,flexWrap:'wrap'}}>
        {hasTietzPdf&&(
          <button onClick={()=>processPdf('tietz')} disabled={!!processing}
            style={{background:tietzDone?T.greenS:T.blueS,border:`0.5px solid ${tietzDone?T.green:T.blue}`,borderRadius:8,padding:'6px 14px',fontSize:11,fontWeight:600,cursor:processing?'not-allowed':'pointer',color:tietzDone?T.green:T.blueText,fontFamily:FONT}}>
            {tietzDone?`✓ Tietz (${pdfData.tietz.sections.length} sec · ${(pdfMeta[topicPdfKey(topic+'§tietz')]||[]).length} PDFs)`:processing==='tietz'?'⏳ Extrayendo...':'📘 Extraer Tietz'}
          </button>
        )}
        {hasHenryPdf&&(
          <button onClick={()=>processPdf('henry')} disabled={!!processing}
            style={{background:henryDone?T.greenS:T.amberS,border:`0.5px solid ${henryDone?T.green:T.amber}`,borderRadius:8,padding:'6px 14px',fontSize:11,fontWeight:600,cursor:processing?'not-allowed':'pointer',color:henryDone?T.green:T.amberText,fontFamily:FONT}}>
            {henryDone?`✓ Henry (${pdfData.henry.sections.length} sec · ${(pdfMeta[topicPdfKey(topic+'§henry')]||[]).length} PDFs)`:processing==='henry'?'⏳ Extrayendo...':'📙 Extraer Henry'}
          </button>
        )}
      </div>
      {/* Progress */}
      {processing&&(
        <div style={{marginBottom:8}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
            <span style={{fontSize:11,color:T.text,fontWeight:600}}>{progress.step}</span>
            <span style={{fontSize:11,color:T.muted}}>{progress.pct}%</span>
          </div>
          <PBar pct={progress.pct} color={T.green} height={3}/>
          {progress.detail&&<div style={{fontSize:10,color:T.dim,marginTop:2}}>{progress.detail}</div>}
        </div>
      )}
      {!processing&&!hasTietzPdf&&!hasHenryPdf&&<div style={{fontSize:11,color:T.dim}}>Sube un PDF de Tietz o Henry arriba para extraer contenido.</div>}
      {progress.step&&progress.step.startsWith('Error')&&<div style={{fontSize:11,color:T.red,marginTop:4}}>{progress.step}</div>}
      {progress.step&&progress.step.startsWith('✓')&&<div style={{fontSize:11,color:T.green,marginTop:4}}>{progress.step}</div>}
      {/* Raw text storage indicator */}
      {(rawTextInfo.tietz||rawTextInfo.henry)&&(
        <div style={{marginTop:6,display:'flex',gap:8,flexWrap:'wrap'}}>
          {rawTextInfo.tietz&&<span style={{fontSize:10,color:T.green,background:T.greenS,padding:'2px 8px',borderRadius:4}}>✓ Texto Tietz guardado — {rawTextInfo.tietz.words.toLocaleString()} palabras</span>}
          {rawTextInfo.henry&&<span style={{fontSize:10,color:T.green,background:T.greenS,padding:'2px 8px',borderRadius:4}}>✓ Texto Henry guardado — {rawTextInfo.henry.words.toLocaleString()} palabras</span>}
        </div>
      )}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// APUNTES TAB — apuntes auto-generados desde el contenido de Aprendizaje
// ═══════════════════════════════════════════════════════════════════════════

// ── Markdown renderer for medical notes ──────────────────────────────────
function MedicalMarkdown({text}){
  if(!text)return null;
  const READING='Georgia,Cambria,"Times New Roman",serif';

  // Extract inline TOC headings
  const lines=text.split('\n');
  const elements=[];
  let i=0;
  let listBuffer=[];

  const flushList=()=>{
    if(!listBuffer.length)return;
    elements.push(<ul key={`ul-${elements.length}`} style={{margin:'8px 0 16px 4px',paddingLeft:20,listStyleType:'none'}}>{listBuffer.map((li,j)=>(
      <li key={j} style={{fontSize:16,lineHeight:1.8,color:T.text,marginBottom:4,position:'relative',paddingLeft:12}}>
        <span style={{position:'absolute',left:-8,color:T.teal,fontWeight:700}}>•</span>
        {renderInline(li)}
      </li>
    ))}</ul>);
    listBuffer=[];
  };

  // Render inline markdown: **bold**, *italic*, `code`, numbers with units
  const renderInline=(str)=>{
    const parts=[];
    // Regex to match **bold**, *italic*, `code`
    const rx=/(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|(\d+[\.,]?\d*\s*(?:mg\/[dL]+|g\/[dL]+|µmol\/[Ll]|mmol\/[Ll]|mEq\/[Ll]|U\/[Ll]|ng\/[dLm]+|pg\/[mL]+|fl|%|×10[³⁹⁶]\/[µL]+|mm³|kDa|Da|μg|mg|g|kg|mL|dL|L|µL|h|min|s|rpm|°C|IU|UI|pH|nm|μm|mm|cm)))/g;
    let last=0;let m;
    while((m=rx.exec(str))!==null){
      if(m.index>last)parts.push(str.slice(last,m.index));
      if(m[2])parts.push(<strong key={`b${m.index}`} style={{fontWeight:700,color:T.text}}>{m[2]}</strong>);
      else if(m[3])parts.push(<em key={`i${m.index}`} style={{fontStyle:'italic',color:T.muted}}>{m[3]}</em>);
      else if(m[4])parts.push(<code key={`c${m.index}`} style={{background:T.tealS,color:T.tealText,padding:'1px 5px',borderRadius:3,fontSize:'0.9em',fontFamily:'Consolas,monospace'}}>{m[4]}</code>);
      else if(m[5])parts.push(<span key={`n${m.index}`} style={{fontWeight:700,color:T.teal}}>{m[5]}</span>);
      last=m.index+m[0].length;
    }
    if(last<str.length)parts.push(str.slice(last));
    return parts.length?parts:str;
  };

  while(i<lines.length){
    const line=lines[i];
    const trimmed=line.trim();

    // Empty line → paragraph break
    if(!trimmed){flushList();elements.push(<div key={`sp-${i}`} style={{height:12}}/>);i++;continue;}

    // Clinical pearl / important note detection
    const pearlRx=/^(?:💡|⚠️?|🔑|📌|❗|🩺|Perla clínica|PERLA|Nota importante|NOTA|Importante|IMPORTANTE|Recuerda|RECUERDA)[:\s]*(.*)/i;
    const pearlMatch=trimmed.match(pearlRx);
    if(pearlMatch){
      flushList();
      const icon=trimmed.match(/^(💡|⚠️?|🔑|📌|❗|🩺)/)?.[0]||'💡';
      const pearlText=pearlMatch[1]||trimmed.replace(pearlRx,'').trim();
      elements.push(
        <div key={`pearl-${i}`} style={{margin:'16px 0',padding:'14px 18px',background:T.amberS,borderLeft:`4px solid ${T.amber}`,borderRadius:'0 10px 10px 0',display:'flex',gap:12,alignItems:'flex-start'}}>
          <span style={{fontSize:20,flexShrink:0,lineHeight:1}}>{icon}</span>
          <div style={{fontSize:15,lineHeight:1.8,color:T.text,fontFamily:READING}}>{renderInline(pearlText)}</div>
        </div>
      );i++;continue;
    }

    // Headings: # ## ### or ALL CAPS lines (>4 words all uppercase)
    const h1=trimmed.match(/^#\s+(.*)/);
    const h2=trimmed.match(/^##\s+(.*)/);
    const h3=trimmed.match(/^###\s+(.*)/);
    const isAllCaps=trimmed.length>8&&trimmed===trimmed.toUpperCase()&&/[A-ZÁÉÍÓÚÑ]{4,}/.test(trimmed)&&!trimmed.startsWith('-')&&!trimmed.startsWith('•');

    if(h1||isAllCaps){
      flushList();
      const title=h1?h1[1]:trimmed;
      const slug=title.toLowerCase().replace(/[^a-záéíóúñ0-9]+/g,'-');
      elements.push(
        <div key={`h1-${i}`} id={`sec-${slug}`} style={{marginTop:elements.length?32:0,marginBottom:16}}>
          <h3 style={{fontSize:19,fontWeight:800,color:T.teal,fontFamily:READING,letterSpacing:0.3,margin:0,lineHeight:1.4}}>{title.charAt(0).toUpperCase()+title.slice(1).toLowerCase().replace(/(^|\.\s+)([a-záéíóúñ])/g,(_,p,c)=>p+c.toUpperCase())}</h3>
          <div style={{height:3,width:50,background:`linear-gradient(90deg,${T.teal},transparent)`,borderRadius:2,marginTop:6}}/>
        </div>
      );i++;continue;
    }
    if(h2){
      flushList();
      const slug=h2[1].toLowerCase().replace(/[^a-záéíóúñ0-9]+/g,'-');
      elements.push(
        <h4 key={`h2-${i}`} id={`sec-${slug}`} style={{fontSize:17,fontWeight:700,color:T.text,fontFamily:READING,margin:'24px 0 10px',borderBottom:`1px solid ${T.border}`,paddingBottom:6}}>{h2[1]}</h4>
      );i++;continue;
    }
    if(h3){
      flushList();
      elements.push(
        <h5 key={`h3-${i}`} style={{fontSize:15,fontWeight:700,color:T.tealText,fontFamily:READING,margin:'18px 0 8px'}}>{h3[1]}</h5>
      );i++;continue;
    }

    // List items: - or • or numbered (1. 2.)
    const listMatch=trimmed.match(/^[-•]\s+(.*)/)||trimmed.match(/^\d+[.)]\s+(.*)/);
    if(listMatch){listBuffer.push(listMatch[1]);i++;continue;}

    // Regular paragraph
    flushList();
    elements.push(
      <p key={`p-${i}`} style={{fontSize:16,lineHeight:1.8,color:T.text,margin:'0 0 14px',fontFamily:READING}}>{renderInline(trimmed)}</p>
    );
    i++;
  }
  flushList();
  return <>{elements}</>;
}

function TopicApuntesTab({topic,learning,saveLearningData,bgJobs,startBgJob,clearJob}){
  const [generating,setGenerating]=useState(false);
  const [genMsg,setGenMsg]=useState('');
  const [editIdx,setEditIdx]=useState(null);
  const [editText,setEditText]=useState('');
  const [openSec,setOpenSec]=useState(0);

  const notes=learning?.notes||[];
  const hasSections=(learning?.sections||[]).some(s=>s.generated);

  // Collect all concepts from all sections/subsections
  const collectSectionsData=()=>{
    const result=[];
    (learning?.sections||[]).forEach(sec=>{
      const concepts=sec.generated?.conceptMap||[];
      const subs=(sec.subsections||[]).flatMap(sub=>sub.generated?.conceptMap||[]);
      if(concepts.length||subs.length) result.push({title:sec.title,concepts:[...concepts,...subs]});
    });
    return result;
  };

  const generateNotes=async()=>{
    const sectionsData=collectSectionsData();
    if(!sectionsData.length){setGenMsg('Genera aprendizaje en al menos una sección primero.');return;}
    setGenerating(true);setGenMsg('Sintetizando apuntes de todas las secciones...');
    try{
      const res=await fetch('/api/anthropic',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:8192,messages:[{role:'user',content:`Eres un experto en bioquímica clínica preparando apuntes de estudio para la oposición FEA Laboratorio Clínico (SESCAM 2025). IDIOMA: Todo en español. Responde SOLO con JSON válido.

TEMA: "${topic}"

A partir de los conceptos extraídos de cada sección, genera unos apuntes estructurados completos.

SECCIONES Y CONCEPTOS:
${JSON.stringify(sectionsData.slice(0,20))}

JSON:
{"notes":[{"section":"Título de la sección","content":"Texto con markdown: usa # para títulos principales, ## para subtítulos, **negrita** para términos clave, - para listas. Incluye TODOS los valores numéricos con unidades, mecanismos paso a paso, relaciones causales. Marca las perlas clínicas con 💡 al inicio de la línea. Usa párrafos separados por línea vacía."}]}

Requisitos:
- Una entrada por cada sección proporcionada, en el mismo orden
- Usar formato markdown: # títulos, ## subtítulos, **negrita**, - listas, 💡 perlas clínicas
- Incluir TODOS los conceptos, valores y mecanismos
- Valores numéricos siempre con unidades y en **negrita**
- Mecanismos descritos paso a paso con listas numeradas
- Perlas clínicas en líneas que empiecen con 💡
- Lenguaje técnico de especialista FEA
- Mínimo 200 palabras por sección`}]})
      });
      if(!res.ok)throw new Error(`HTTP ${res.status}`);
      const data=await res.json();
      const text=(data.content||[]).map(c=>c.text||'').join('').trim().replace(/```json|```/g,'').trim();
      const parsed=JSON.parse(repairJSON(text));
      const generatedNotes=(parsed.notes||parsed).map(n=>({section:n.section||'Sin título',content:n.content||'',generatedAt:new Date().toISOString()}));
      await saveLearningData(topic,{...learning,notes:generatedNotes});
      setGenMsg('');
    }catch(e){setGenMsg(`Error: ${e.message}`);}
    setGenerating(false);
  };

  const saveEdit=(idx)=>{
    const updNotes=notes.map((n,i)=>i===idx?{...n,content:editText,editedAt:new Date().toISOString()}:n);
    saveLearningData(topic,{...learning,notes:updNotes});
    setEditIdx(null);
  };

  const exportPdf=()=>{
    const content=notes.map(n=>`\n${'═'.repeat(60)}\n${n.section}\n${'═'.repeat(60)}\n\n${n.content}\n`).join('\n');
    const full=`APUNTES: ${topic}\nGenerado: ${new Date().toLocaleDateString('es-ES')}\n${content}`;
    const blob=new Blob([full],{type:'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=`apuntes_${topic.split('.')[0]}.txt`;a.click();URL.revokeObjectURL(url);
  };

  // Extract TOC from all notes
  const tocItems=useMemo(()=>{
    const items=[];
    notes.forEach((n,ni)=>{
      items.push({level:0,title:n.section,secIdx:ni,id:`toc-sec-${ni}`});
      (n.content||'').split('\n').forEach(line=>{
        const t=line.trim();
        const h1=t.match(/^#\s+(.*)/);
        const h2=t.match(/^##\s+(.*)/);
        const isAllCaps=t.length>8&&t===t.toUpperCase()&&/[A-ZÁÉÍÓÚÑ]{4,}/.test(t)&&!t.startsWith('-')&&!t.startsWith('•');
        if(h2)items.push({level:2,title:h2[1],secIdx:ni,id:`sec-${h2[1].toLowerCase().replace(/[^a-záéíóúñ0-9]+/g,'-')}`});
        else if(h1||isAllCaps){
          const title=h1?h1[1]:t;
          items.push({level:1,title:title.charAt(0).toUpperCase()+title.slice(1).toLowerCase().replace(/(^|\.\s+)([a-záéíóúñ])/g,(_,p,c)=>p+c.toUpperCase()),secIdx:ni,id:`sec-${title.toLowerCase().replace(/[^a-záéíóúñ0-9]+/g,'-')}`});
        }
      });
    });
    return items;
  },[notes]);

  const READING='Georgia,Cambria,"Times New Roman",serif';

  if(!notes.length) return(
    <Card style={{padding:'32px',maxWidth:680,margin:'0 auto'}}>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:48,marginBottom:12}}>📖</div>
        <div style={{fontSize:18,fontWeight:700,color:T.text,marginBottom:8,fontFamily:READING}}>Apuntes del tema</div>
        <div style={{fontSize:14,color:T.dim,marginBottom:24,lineHeight:1.7,maxWidth:420,margin:'0 auto 24px'}}>
          {hasSections
            ?'Genera apuntes profesionales a partir de toda la información extraída en las secciones de Aprendizaje.'
            :'Primero genera el aprendizaje en al menos una sección. Los apuntes se sintetizan a partir de los conceptos extraídos.'}
        </div>
        <button onClick={generateNotes} disabled={generating||!hasSections}
          style={{background:generating?T.surface:(!hasSections?T.surface:T.teal),color:generating?T.dim:(!hasSections?T.dim:'#fff'),border:'none',borderRadius:10,padding:'12px 28px',fontSize:14,fontWeight:700,cursor:generating||!hasSections?'not-allowed':'pointer',fontFamily:FONT,boxShadow:generating||!hasSections?'none':sh.md,transition:'all 200ms'}}>
          {generating?'⏳ Generando apuntes...':'Generar apuntes del tema'}
        </button>
        {genMsg&&<div style={{marginTop:14,fontSize:13,color:genMsg.startsWith('Error')?T.red:T.muted}}>{genMsg}</div>}
      </div>
    </Card>
  );

  return(
    <div style={{display:'flex',gap:20,alignItems:'flex-start'}}>
      {/* Sidebar TOC */}
      <Card style={{position:'sticky',top:12,width:220,flexShrink:0,padding:'16px 0',maxHeight:'calc(100vh - 80px)',overflowY:'auto'}}>
        <div style={{padding:'0 16px 10px',fontSize:10,fontWeight:700,color:T.dim,textTransform:'uppercase',letterSpacing:0.8}}>Contenidos</div>
        {tocItems.map((item,j)=>{
          const isSec=item.level===0;
          const isActive=isSec&&item.secIdx===openSec;
          return(
            <button key={j} onClick={()=>{setOpenSec(item.secIdx);if(!isSec){setTimeout(()=>{const el=document.getElementById(item.id);el?.scrollIntoView({behavior:'smooth',block:'start'});},80);}}}
              style={{display:'block',width:'100%',textAlign:'left',background:isActive?T.tealS:'transparent',border:'none',borderLeft:isActive?`3px solid ${T.teal}`:'3px solid transparent',padding:isSec?'8px 16px':`4px 16px 4px ${16+item.level*12}px`,fontSize:isSec?12:11,fontWeight:isSec?700:400,color:isActive?T.teal:isSec?T.text:T.muted,cursor:'pointer',fontFamily:FONT,lineHeight:1.4,transition:'all 150ms'}}>
              {item.title}
            </button>
          );
        })}
        <div style={{borderTop:`1px solid ${T.border}`,margin:'12px 16px 0',paddingTop:12,display:'flex',gap:6,flexWrap:'wrap'}}>
          <button onClick={exportPdf} style={{fontSize:10,background:T.surface,border:`0.5px solid ${T.border}`,borderRadius:6,padding:'4px 10px',cursor:'pointer',color:T.muted,fontFamily:FONT}}>📥 Exportar</button>
          <button onClick={generateNotes} disabled={generating} style={{fontSize:10,background:T.surface,border:`0.5px solid ${T.border}`,borderRadius:6,padding:'4px 10px',cursor:'pointer',color:T.muted,fontFamily:FONT}}>{generating?'⏳...':'🔄 Regenerar'}</button>
        </div>
      </Card>

      {/* Main content */}
      <div style={{flex:1,minWidth:0}}>
        {/* Header */}
        <div style={{marginBottom:20}}>
          <div style={{fontSize:11,color:T.dim,fontWeight:600,textTransform:'uppercase',letterSpacing:0.8,marginBottom:4}}>Apuntes de estudio</div>
          <div style={{fontSize:22,fontWeight:800,color:T.text,fontFamily:READING,lineHeight:1.3}}>{topic}</div>
          <div style={{fontSize:12,color:T.dim,marginTop:4}}>{notes.length} secciones · Generado el {fmtDate(notes[0]?.generatedAt)}</div>
        </div>

        {/* Section tabs (mobile-friendly, redundant to sidebar) */}
        <div style={{display:'flex',gap:6,marginBottom:18,flexWrap:'wrap',overflowX:'auto'}}>
          {notes.map((n,i)=>(
            <button key={i} onClick={()=>setOpenSec(i)} style={{padding:'6px 14px',fontSize:11,fontWeight:openSec===i?700:500,color:openSec===i?T.teal:T.muted,background:openSec===i?T.tealS:T.surface,border:`1px solid ${openSec===i?T.teal:T.border}`,borderRadius:8,cursor:'pointer',fontFamily:FONT,whiteSpace:'nowrap',transition:'all 150ms'}}>
              {n.section}
            </button>
          ))}
        </div>

        {/* Active section content */}
        {notes.map((n,i)=>{
          if(i!==openSec)return null;
          const isEditing=editIdx===i;
          return(
            <Card key={i} style={{padding:'28px 32px'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,borderBottom:`2px solid ${T.teal}`,paddingBottom:14}}>
                <h2 style={{fontSize:20,fontWeight:800,color:T.teal,margin:0,fontFamily:READING}}>{n.section}</h2>
                <button onClick={()=>{if(isEditing){saveEdit(i);}else{setEditIdx(i);setEditText(n.content);}}}
                  style={{fontSize:11,background:isEditing?T.teal:T.surface,color:isEditing?'#fff':T.muted,border:`1px solid ${isEditing?T.teal:T.border}`,borderRadius:8,padding:'5px 14px',cursor:'pointer',fontFamily:FONT,fontWeight:600,transition:'all 150ms'}}>
                  {isEditing?'💾 Guardar':'✏️ Editar'}
                </button>
              </div>
              {isEditing?(
                <textarea value={editText} onChange={e=>setEditText(e.target.value)}
                  style={{width:'100%',minHeight:400,background:T.bg,color:T.text,border:`1px solid ${T.border}`,borderRadius:10,padding:'16px 18px',fontSize:14,fontFamily:'Consolas,Monaco,monospace',resize:'vertical',outline:'none',boxSizing:'border-box',lineHeight:1.7}}/>
              ):(
                <div style={{maxWidth:720}}>
                  <MedicalMarkdown text={n.content}/>
                </div>
              )}
              {n.editedAt&&<div style={{fontSize:10,color:T.dim,marginTop:16,paddingTop:8,borderTop:`1px solid ${T.border}`}}>Editado el {fmtDate(n.editedAt)}</div>}

              {/* Section navigation */}
              <div style={{display:'flex',justifyContent:'space-between',marginTop:24,paddingTop:16,borderTop:`1px solid ${T.border}`}}>
                {i>0?<button onClick={()=>setOpenSec(i-1)} style={{fontSize:12,background:'none',border:'none',color:T.teal,cursor:'pointer',fontFamily:FONT,fontWeight:600}}>← {notes[i-1].section}</button>:<span/>}
                {i<notes.length-1?<button onClick={()=>setOpenSec(i+1)} style={{fontSize:12,background:'none',border:'none',color:T.teal,cursor:'pointer',fontFamily:FONT,fontWeight:600}}>{notes[i+1].section} →</button>:<span/>}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PREGUNTAS TAB — todas las preguntas del tema con metadatos y generación
// ═══════════════════════════════════════════════════════════════════════════
function TopicPreguntasTab({topic,allQuestions,topicTag,stats,saveQs,qs,apiKey,learning,bgJobs,startBgJob,clearJob}){
  const [mode,setMode]=useState('browse'); // browse | practice | exam
  const [filter,setFilter]=useState({section:'',type:'',difficulty:'',status:''});
  const [generating,setGenerating]=useState(false);
  const [genMsg,setGenMsg]=useState('');
  // Practice state
  const [practiceQs,setPracticeQs]=useState([]);
  const [practiceIdx,setPracticeIdx]=useState(0);
  const [practiceAnswer,setPracticeAnswer]=useState(null);
  const [practiceRevealed,setPracticeRevealed]=useState(false);
  const [practiceStats,setPracticeStats]=useState({c:0,t:0});
  // Per-question stats from localStorage
  const [qStats,setQStats]=useState(()=>load('olab_qstats',{}));

  const sections=[...new Set(allQuestions.map(q=>q.seccion||q._section||'General'))].sort();
  const types=[...new Set(allQuestions.map(q=>q.tipo||q._source||q.type||'—'))];
  const diffs=[...new Set(allQuestions.map(q=>q.dificultad||'—'))].filter(d=>d!=='—');

  const filtered=allQuestions.filter(q=>{
    if(filter.section&&(q.seccion||q._section||'General')!==filter.section)return false;
    if(filter.type&&(q.tipo||q._source||q.type)!==filter.type)return false;
    if(filter.difficulty&&(q.dificultad||'—')!==filter.difficulty)return false;
    if(filter.status==='failed'&&!(qStats[q.id]?.t>0&&qStats[q.id].c/qStats[q.id].t<0.5))return false;
    if(filter.status==='unanswered'&&qStats[q.id]?.t>0)return false;
    return true;
  });

  const sourceContext=useMemo(()=>{
    if(learning?.notes?.length) return learning.notes.map(n=>`SECCIÓN: ${n.section}\n${n.content}`).join('\n\n').slice(0,15000);
    const concepts=[];
    (learning?.sections||[]).forEach(sec=>{
      (sec.generated?.conceptMap||[]).forEach(c=>concepts.push(`[${sec.title}] ${c.t}: ${c.d}`));
      (sec.subsections||[]).forEach(sub=>(sub.generated?.conceptMap||[]).forEach(c=>concepts.push(`[${sec.title}>${sub.title}] ${c.t}: ${c.d}`)));
    });
    return concepts.length?concepts.join('\n').slice(0,15000):'';
  },[learning]);

  const generateMore=async()=>{
    setGenerating(true);setGenMsg('Generando 20 preguntas...');
    try{
      const ctxBlock=sourceContext?`\n\nCONTENIDO:\n${sourceContext}`:'';
      const res=await fetch('/api/anthropic',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:8192,messages:[{role:'user',content:`Eres experto FEA Lab. Clínico. IDIOMA: español. SOLO JSON válido.\n\n20 preguntas test de "${topic}".${ctxBlock}\n\nJSON:\n{"questions":[{"id":"n1","question":"...","options":["A)...","B)...","C)...","D)..."],"correct":0,"explanation":"breve","tipo":"concepto","dificultad":"media","tema":"${topicTag}","seccion":"General","fase":"extra"}]}`}]})});
      if(!res.ok)throw new Error(`HTTP ${res.status}`);
      const data=await res.json();
      const text=(data.content||[]).map(c=>c.text||'').join('').trim().replace(/```json|```/g,'').trim();
      const newQs=(JSON.parse(repairJSON(text)).questions||JSON.parse(repairJSON(text))).map(q=>({...q,id:uid(),type:'test',topic,tema:topicTag,fase:'extra',fechaGeneracion:new Date().toISOString().slice(0,10)}));
      await saveQs([...qs,...newQs]);
      setGenMsg(`✓ ${newQs.length} preguntas añadidas`);setTimeout(()=>setGenMsg(''),3000);
    }catch(e){setGenMsg(`Error: ${e.message}`);}
    setGenerating(false);
  };

  // Record answer for per-question stats
  const recordPracticeAnswer=(q,selectedIdx)=>{
    const correct=selectedIdx===q.correct;
    setPracticeAnswer(selectedIdx);setPracticeRevealed(true);
    setPracticeStats(prev=>({c:prev.c+(correct?1:0),t:prev.t+1}));
    setQStats(prev=>{
      const cur=prev[q.id]||{c:0,t:0,last:null};
      const n={...prev,[q.id]:{c:cur.c+(correct?1:0),t:cur.t+1,last:new Date().toISOString()}};
      save('olab_qstats',n);return n;
    });
  };

  const startPractice=(examMode)=>{
    const pool=shuffle(filtered.filter(q=>q.type==='test'&&q.options));
    if(!pool.length)return;
    setPracticeQs(pool);setPracticeIdx(0);setPracticeAnswer(null);setPracticeRevealed(false);
    setPracticeStats({c:0,t:0});setMode(examMode?'exam':'practice');
  };

  // ── Practice/Exam mode ──
  if(mode==='practice'||mode==='exam'){
    const q=practiceQs[practiceIdx];
    if(!q||practiceIdx>=practiceQs.length){
      const pct=practiceStats.t?Math.round(practiceStats.c/practiceStats.t*100):0;
      return(
        <Card style={{padding:'28px',textAlign:'center'}}>
          <div style={{fontSize:40,marginBottom:10}}>{pct>=70?'🎉':'📚'}</div>
          <div style={{fontSize:24,fontWeight:700,color:pct>=70?T.green:pct>=50?T.amber:T.red}}>{pct}%</div>
          <div style={{fontSize:13,color:T.text,marginBottom:4}}>{practiceStats.c} de {practiceStats.t} correctas</div>
          <div style={{fontSize:12,color:T.dim,marginBottom:16}}>{mode==='exam'?'Modo examen':'Práctica'} · {topic.split('.')[0]}</div>
          <Btn onClick={()=>{setMode('browse');}} variant="primary">Volver a preguntas</Btn>
        </Card>
      );
    }
    const qs_=qStats[q.id];
    return(
      <div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <span style={{fontSize:13,fontWeight:600,color:T.text}}>{mode==='exam'?'Examen':'Práctica'} — {practiceIdx+1}/{practiceQs.length}</span>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <span style={{fontSize:11,color:T.muted}}>{practiceStats.c}/{practiceStats.t}</span>
            <button onClick={()=>setMode('browse')} style={{fontSize:11,background:'none',border:`0.5px solid ${T.border}`,borderRadius:6,padding:'3px 10px',cursor:'pointer',color:T.muted,fontFamily:FONT}}>Salir</button>
          </div>
        </div>
        <PBar pct={practiceIdx/practiceQs.length*100} color={T.blue} height={3}/>
        <Card style={{padding:'18px',marginTop:12}}>
          {/* Metadata */}
          <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:8}}>
            {q.seccion&&<span style={{fontSize:9,color:T.muted,background:T.surface,padding:'1px 5px',borderRadius:4,border:`0.5px solid ${T.border}`}}>{q.seccion}</span>}
            {q.tipo&&<span style={{fontSize:9,color:T.blue,background:T.blueS,padding:'1px 5px',borderRadius:4}}>{q.tipo}</span>}
            {q.dificultad&&<span style={{fontSize:9,color:q.dificultad==='alta'?T.red:q.dificultad==='media'?T.amber:T.green,background:q.dificultad==='alta'?T.redS:q.dificultad==='media'?T.amberS:T.greenS,padding:'1px 5px',borderRadius:4}}>{q.dificultad}</span>}
            {qs_?.t>0&&<span style={{fontSize:9,color:T.dim}}>Respondida {qs_.t}x · {Math.round(qs_.c/qs_.t*100)}%</span>}
          </div>
          <div style={{fontSize:14,color:T.text,lineHeight:1.8,marginBottom:14,fontWeight:500}}>{q.question}</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {(q.options||[]).map((opt,j)=>{
              let bg=T.card,bdr=T.border,col=T.text;
              if(practiceRevealed&&j===q.correct){bg=T.greenS;bdr=T.green;col=T.greenText;}
              else if(practiceRevealed&&practiceAnswer===j&&j!==q.correct){bg=T.redS;bdr=T.red;col=T.redText;}
              else if(!practiceRevealed&&practiceAnswer===j){bg=T.blueS;bdr=T.blue;col=T.blueText;}
              return <button key={j} onClick={()=>{if(!practiceRevealed){if(mode==='practice')recordPracticeAnswer(q,j);else{setPracticeAnswer(j);}}}}
                disabled={practiceRevealed&&mode==='practice'}
                style={{background:bg,border:`0.5px solid ${bdr}`,borderRadius:8,padding:'10px 12px',fontSize:12,textAlign:'left',cursor:practiceRevealed?'default':'pointer',color:col,fontFamily:FONT}}>{opt}</button>;
            })}
          </div>
          {/* Feedback — always show in practice, after submit in exam */}
          {practiceRevealed&&(mode==='practice'||true)&&q.explanation&&(
            <div style={{marginTop:10,padding:'8px 12px',background:T.blueS,borderRadius:8,fontSize:11,color:T.blueText,lineHeight:1.6,borderLeft:`2px solid ${T.blue}`}}>{q.explanation}</div>
          )}
          <div style={{display:'flex',justifyContent:'flex-end',marginTop:12,gap:8}}>
            {mode==='exam'&&!practiceRevealed&&practiceAnswer!=null&&(
              <button onClick={()=>{recordPracticeAnswer(q,practiceAnswer);}} style={{background:T.green,color:'#fff',border:'none',borderRadius:6,padding:'6px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:FONT}}>Confirmar</button>
            )}
            {practiceRevealed&&(
              <button onClick={()=>{setPracticeIdx(i=>i+1);setPracticeAnswer(null);setPracticeRevealed(false);}} style={{background:'none',border:`0.5px solid ${T.border}`,borderRadius:6,padding:'6px 16px',fontSize:12,cursor:'pointer',color:T.muted,fontFamily:FONT}}>Siguiente →</button>
            )}
          </div>
        </Card>
      </div>
    );
  }

  // ── Browse mode ──
  return(
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,flexWrap:'wrap',gap:8}}>
        <div style={{fontSize:14,fontWeight:700,color:T.text}}>{allQuestions.length} preguntas</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          <select value={filter.section} onChange={e=>setFilter(f=>({...f,section:e.target.value}))} style={{background:T.surface,color:T.text,border:`0.5px solid ${T.border}`,borderRadius:6,padding:'4px 8px',fontSize:11,fontFamily:FONT}}>
            <option value="">Todas secciones</option>
            {sections.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filter.type} onChange={e=>setFilter(f=>({...f,type:e.target.value}))} style={{background:T.surface,color:T.text,border:`0.5px solid ${T.border}`,borderRadius:6,padding:'4px 8px',fontSize:11,fontFamily:FONT}}>
            <option value="">Todos tipos</option>
            {types.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
          {diffs.length>0&&<select value={filter.difficulty} onChange={e=>setFilter(f=>({...f,difficulty:e.target.value}))} style={{background:T.surface,color:T.text,border:`0.5px solid ${T.border}`,borderRadius:6,padding:'4px 8px',fontSize:11,fontFamily:FONT}}>
            <option value="">Toda dificultad</option>
            {diffs.map(d=><option key={d} value={d}>{d}</option>)}
          </select>}
          <select value={filter.status} onChange={e=>setFilter(f=>({...f,status:e.target.value}))} style={{background:T.surface,color:T.text,border:`0.5px solid ${T.border}`,borderRadius:6,padding:'4px 8px',fontSize:11,fontFamily:FONT}}>
            <option value="">Todas</option>
            <option value="failed">Solo falladas</option>
            <option value="unanswered">No respondidas</option>
          </select>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:16}}>
        <Btn onClick={()=>startPractice(false)} disabled={!filtered.filter(q=>q.type==='test').length} variant="primary" style={{padding:'8px 16px',fontSize:12}}>▶ Practicar ({filtered.filter(q=>q.type==='test').length})</Btn>
        <Btn onClick={()=>startPractice(true)} disabled={!filtered.filter(q=>q.type==='test').length} variant="orange" style={{padding:'8px 16px',fontSize:12}}>⚡ Modo examen</Btn>
        <button onClick={generateMore} disabled={generating}
          style={{background:generating?T.surface:T.green,color:generating?T.dim:'#000',border:`0.5px solid ${generating?T.border:T.green}`,borderRadius:8,padding:'8px 16px',fontSize:12,fontWeight:700,cursor:generating?'wait':'pointer',fontFamily:FONT}}>
          {generating?'⏳...':'+ 20 preguntas'}
        </button>
        {genMsg&&<span style={{fontSize:11,color:genMsg.startsWith('✓')?T.green:T.red}}>{genMsg}</span>}
      </div>

      {/* Question list */}
      {filtered.length===0?(
        <Card style={{padding:'40px',textAlign:'center'}}>
          <div style={{fontSize:36,marginBottom:10}}>🧪</div>
          <div style={{fontSize:14,fontWeight:600,color:T.text,marginBottom:4}}>Sin preguntas</div>
          <div style={{fontSize:12,color:T.dim}}>Genera preguntas en Aprendizaje o usa el botón de arriba</div>
        </Card>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          {filtered.slice(0,50).map((q,i)=>{
            const qs_=qStats[q.id];
            return(
              <Card key={q.id||i} style={{padding:'8px 12px'}}>
                <div style={{display:'flex',alignItems:'flex-start',gap:6}}>
                  <span style={{fontSize:9,color:T.dim,background:T.bg,padding:'2px 4px',borderRadius:3,fontWeight:600,flexShrink:0,marginTop:2}}>#{i+1}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,color:T.text,lineHeight:1.5}}>{q.question||q.front||q.presentation}</div>
                    <div style={{display:'flex',gap:3,flexWrap:'wrap',marginTop:3}}>
                      {q.seccion&&<span style={{fontSize:8,color:T.muted,background:T.surface,padding:'1px 4px',borderRadius:3,border:`0.5px solid ${T.border}`}}>{q.seccion}</span>}
                      {q.tipo&&<span style={{fontSize:8,color:T.blue,background:T.blueS,padding:'1px 4px',borderRadius:3}}>{q.tipo}</span>}
                      {q.dificultad&&<span style={{fontSize:8,color:q.dificultad==='alta'?T.red:q.dificultad==='media'?T.amber:T.green,padding:'1px 4px',borderRadius:3,background:q.dificultad==='alta'?T.redS:q.dificultad==='media'?T.amberS:T.greenS}}>{q.dificultad}</span>}
                      {qs_?.t>0&&<span style={{fontSize:8,color:qs_.c/qs_.t>=0.7?T.green:qs_.c/qs_.t>=0.5?T.amber:T.red,fontWeight:600}}>{Math.round(qs_.c/qs_.t*100)}% ({qs_.t}x)</span>}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
          {filtered.length>50&&<div style={{fontSize:11,color:T.dim,textAlign:'center',padding:8}}>+{filtered.length-50} más</div>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// APRENDIZAJE TAB — Secciones desplegables con generación independiente
// ═══════════════════════════════════════════════════════════════════════════
function AprendizajeTab({topic,learning,saveLearningData,pdfMeta,bgJobs,startBgJob,clearJob,allLearningData,setTopicView}){
  const [newTitle,setNewTitle]=useState('');
  const [openSec,setOpenSec]=useState(null);    // index of open section accordion
  const [activePhase,setActivePhase]=useState({}); // {secIdx: phaseIdx}
  const [genIdx,setGenIdx]=useState(null);       // section being generated
  const [genStep,setGenStep]=useState('');
  const [genPct,setGenPct]=useState(0);
  const [genError,setGenError]=useState('');
  const [extracting,setExtracting]=useState(false);
  const [extractMsg,setExtractMsg]=useState('');
  const [dragIdx,setDragIdx]=useState(null);
  const [dragOverIdx,setDragOverIdx]=useState(null);

  // Ensure learning data structure
  const data=learning||{sections:[],spacedRepetition:null};
  const sections=data.sections||[];

  const save=async(updated)=>saveLearningData(topic,updated);

  // ── Add section ───────────────────────────────────────────────────────────
  const addSection=()=>{
    if(!newTitle.trim())return;
    const updated={...data,sections:[...sections,{id:uid(),title:newTitle.trim(),text:'',generated:null}]};
    save(updated);setNewTitle('');
  };

  // ── Extract sections from PDF ─────────────────────────────────────────────
  const extractSectionsFromPdf=async()=>{
    // Find the first available PDF for this topic (Tietz or Henry)
    const tietzKey=topicPdfKey(topic+'§tietz');
    const henryKey=topicPdfKey(topic+'§henry');
    const genericKey=topicPdfKey(topic);
    const allPdfFiles=[...(pdfMeta[tietzKey]||[]).map(f=>({...f,tk:topic+'§tietz'})),...(pdfMeta[henryKey]||[]).map(f=>({...f,tk:topic+'§henry'})),...(pdfMeta[genericKey]||[]).map(f=>({...f,tk:topic}))];
    if(!allPdfFiles.length){setExtractMsg('No hay PDFs subidos. Sube un PDF en la pestaña Temario primero.');return;}

    setExtracting(true);setExtractMsg('Cargando PDF...');
    try{
      const pdfFile=allPdfFiles[0];
      const blob=await idbLoad(topicFilePdfKey(pdfFile.tk,pdfFile.id));
      if(!blob)throw new Error('PDF no encontrado en almacenamiento');

      setExtractMsg('Enviando a IA para extraer secciones...');
      const b64=await blobToB64(blob instanceof File?blob:new File([blob],pdfFile.name,{type:'application/pdf'}));

      const res=await fetch('/api/anthropic',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          model:'claude-sonnet-4-5',max_tokens:4096,
          messages:[{role:'user',content:[
            {type:'document',source:{type:'base64',media_type:'application/pdf',data:b64}},
            {type:'text',text:`IDIOMA: Independientemente del idioma del documento, TODA tu respuesta debe estar en español. Traduce los títulos al español si el documento está en inglés.\n\nAnaliza este documento del tema "${topic}" de bioquímica clínica (FEA Laboratorio Clínico, SESCAM 2025).\n\nIdentifica TODOS los subapartados o secciones principales del capítulo leyendo el índice, tabla de contenidos o encabezados.\n\nDevuelve SOLO JSON válido:\n{"sections":[{"title":"Título de la sección en español","pageHint":"página aproximada"}]}\n\n- Extrae los subapartados reales (no inventes)\n- Incluye TODAS las secciones principales (5-12 típico)\n- Traduce al español si el original está en inglés\n- Ordena en el orden del documento`}
          ]}]
        })
      });
      if(!res.ok){const d=await res.json().catch(()=>({}));throw new Error(d?.error?.message||`HTTP ${res.status}`);}
      const apiData=await res.json();
      const text=(apiData.content||[]).map(c=>c.text||'').join('').trim();
      const cleaned=text.replace(/```json|```/g,'').trim();
      const parsed=JSON.parse(repairJSON(cleaned));
      const extractedSections=parsed.sections||parsed;

      if(!Array.isArray(extractedSections)||!extractedSections.length) throw new Error('No se encontraron secciones');

      // Create sections from extraction
      const newSections=extractedSections.map(s=>({id:uid(),title:s.title||(typeof s==='string'?s:'Sin título'),text:'',generated:null}));
      const updated={...data,sections:[...sections,...newSections]};
      await save(updated);
      setExtractMsg(`✓ ${newSections.length} secciones extraídas del PDF`);
      setTimeout(()=>setExtractMsg(''),3000);
    }catch(e){setExtractMsg(`Error: ${e.message}`);}
    setExtracting(false);
  };

  const removeSection=async(idx)=>{
    const updated={...data,sections:sections.filter((_,i)=>i!==idx)};
    await save(updated);if(openSec===idx)setOpenSec(null);
  };

  const reorderSections=(fromIdx,toIdx)=>{
    if(fromIdx===toIdx)return;
    const arr=[...sections];
    const [moved]=arr.splice(fromIdx,1);
    arr.splice(toIdx,0,moved);
    save({...data,sections:arr});
    // Adjust openSec to follow the moved section
    if(openSec===fromIdx)setOpenSec(toIdx);
    else if(openSec!=null){
      if(fromIdx<openSec&&toIdx>=openSec)setOpenSec(openSec-1);
      else if(fromIdx>openSec&&toIdx<=openSec)setOpenSec(openSec+1);
    }
  };

  const updateSectionText=(idx,text)=>{
    const updated={...data,sections:sections.map((s,i)=>i===idx?{...s,text}:s)};
    save(updated);
  };


  // ── API caller with retries and truncation detection ────────────────────
  const callClaude=async(prompt,maxTokens=4096,retries=3)=>{
    for(let attempt=1;attempt<=retries;attempt++){
      try{
        console.log(`[OPELab] API call (attempt ${attempt}/${retries}, max_tokens=${maxTokens})`);
        const res=await fetch('/api/anthropic',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:maxTokens,messages:[{role:'user',content:prompt}]})
        });
        if(!res.ok){
          const d=await res.json().catch(()=>({}));
          const msg=d?.error?.message||`HTTP ${res.status}`;
          if(attempt<retries&&(res.status===429||res.status>=500)){
            console.warn(`[OPELab] Retryable error: ${msg}. Waiting ${attempt*5}s...`);
            await new Promise(r=>setTimeout(r,attempt*5000));
            continue;
          }
          throw new Error(msg);
        }
        const r=await res.json();
        if(r.stop_reason==='max_tokens'){
          console.warn('[OPELab] Response TRUNCATED by max_tokens');
          if(attempt<retries&&maxTokens<12000){
            console.log('[OPELab] Retrying with more tokens...');
            maxTokens=Math.min(maxTokens+4096,16000);
            continue;
          }
        }
        const text=(r.content||[]).map(c=>c.text||'').join('').trim();
        return text.replace(/```json|```/g,'').trim();
      }catch(e){
        if(attempt>=retries)throw e;
        console.warn(`[OPELab] Attempt ${attempt} failed: ${e.message}. Retrying in ${attempt*3}s...`);
        await new Promise(r=>setTimeout(r,attempt*3000));
      }
    }
  };

  // ── Extract topic number for metadata ────────────────────────────────────
  const topicNum=topic.match(/^T(\d+)/)?.[1]||'';
  const topicTag=topicNum?`T${topicNum}`:'';

  const generateSection=async(idx,subIdx)=>{
    const sec=sections[idx];
    const sub=subIdx!=null?sec.subsections?.[subIdx]:null;
    let targetText=sub?sub.text:(sec.text||'');
    const targetTitle=sub?`${sec.title} > ${sub.title}`:sec.title;
    if(!targetText?.trim()){
      const gid=subIdx!=null?`${idx}-${subIdx}`:idx;
      setGenIdx(gid);
      setGenError('Sin contenido. Pega el texto de la sección primero.');
      setTimeout(()=>{setGenIdx(null);},5000);
      return;
    }
    setGenIdx(subIdx!=null?`${idx}-${subIdx}`:idx);setGenError('');setGenPct(0);

    const SYS='Eres un experto en bioquímica clínica (FEA Lab. Clínico, SESCAM 2025). IDIOMA: Todo en español. Responde SOLO con JSON válido.';
    const textWords=targetText.split(/\s+/).length;
    const needsChunking=textWords>5000;

    // Adaptive session sizing based on content length
    const sizing=textWords<=1500?{pre:8,fc:10,cases:2,inter:3,post:8,fb:3,time:'25-30'}
      :textWords<=4000?{pre:12,fc:15,cases:3,inter:5,post:12,fb:4,time:'40-45'}
      :textWords<=8000?{pre:18,fc:20,cases:4,inter:7,post:18,fb:5,time:'55-65'}
      :{pre:20,fc:25,cases:5,inter:10,post:25,fb:5,time:'75-90'};

    console.log(`[Generate] "${targetTitle}" — ${textWords} words, sizing: pre=${sizing.pre} fc=${sizing.fc} cases=${sizing.cases} post=${sizing.post}`);
    setGenStep(`Sesión ~${sizing.time} min · ${sizing.pre} pretest · ${sizing.fc} flashcards · ${sizing.cases} casos · ${sizing.post} posttest`);
    setGenPct(2);

    const CTX=needsChunking?`TEMA: "${topic}"\nSECCIÓN: "${targetTitle}"`:`TEMA: "${topic}"\nSECCIÓN: "${targetTitle}"\n\nTEXTO:\n${targetText.slice(0,25000)}`;
    const TRANSFER='NUNCA preguntes lo que dice el texto. SIEMPRE presenta el concepto en contexto clínico NUEVO.';
    const CALIB=getDiffCalibration();
    // Concept distribution instruction for all question-generating prompts
    const DISTRIB=`\n\nDISTRIBUCIÓN: Genera exactamente 1 pregunta por concepto diferente. Ningún concepto debe aparecer en más de 2 preguntas. Prioriza los conceptos más importantes clínicamente.`;
    const now=new Date();
    const dateTag=now.toISOString().slice(0,10);

    // Checkpoint-based generation: each phase runs independently
    const phases={};
    const errors=[];
    let conceptList=[];
    let cMap='[]';

    // Helper: run a phase with error isolation
    const runPhase=async(name,pct,fn)=>{
      setGenStep(`${name}...`);setGenPct(pct);
      console.log(`[OPELab] ${name}`);
      try{
        const result=await fn();
        console.log(`[OPELab] ✓ ${name}`);
        return result;
      }catch(e){
        console.error(`[OPELab] ✗ ${name}: ${e.message}`);
        errors.push(`${name}: ${e.message}`);
        return null;
      }
    };

    // Phase 1: Concepts (required — abort if fails)
    const concepts=await runPhase(needsChunking?`1/10 Extrayendo conceptos (${Math.ceil(textWords/4000)} chunks)`:'1/10 Extrayendo conceptos',5,async()=>{
      if(needsChunking){
        // Split text into ~4000-word chunks at paragraph boundaries
        const paras=targetText.split(/\n\n+/);
        const chunks=[];let cur=[];let cw=0;
        for(const p of paras){const wc=p.split(/\s+/).length;if(cw+wc>4000&&cur.length){chunks.push(cur.join('\n\n'));cur=[p];cw=wc;}else{cur.push(p);cw+=wc;}}
        if(cur.length)chunks.push(cur.join('\n\n'));
        console.log(`[OPELab] Chunking: ${textWords} words → ${chunks.length} chunks`);
        const allConcepts=[];
        for(let ci=0;ci<chunks.length;ci++){
          setGenStep(`1/10 Extrayendo conceptos (chunk ${ci+1}/${chunks.length})...`);
          const raw=await callClaude(`${SYS}\n\nExtrae información clave.\n\n${CTX}\n\nTEXTO (parte ${ci+1}/${chunks.length}):\n${chunks[ci]}\n\nJSON:\n{"concepts":[{"t":"título","d":"descripción breve","cat":"concept|value|mechanism|clinical"}]}\n\nSé exhaustivo.`);
          const p=JSON.parse(repairJSON(raw));
          const c=p.concepts||p;
          if(Array.isArray(c))allConcepts.push(...c);
        }
        conceptList=allConcepts;
      }else{
        const raw=await callClaude(`${SYS}\n\nExtrae información clave.\n\n${CTX}\n\nJSON:\n{"concepts":[{"t":"título","d":"descripción breve","cat":"concept|value|mechanism|clinical"}]}\n\nSé exhaustivo.`);
        const p=JSON.parse(repairJSON(raw));
        conceptList=p.concepts||p;
      }
      cMap=JSON.stringify(Array.isArray(conceptList)?conceptList.slice(0,60):[]);
      return conceptList;
    });
    if(!concepts){setGenError('Error extrayendo conceptos: '+errors.join('. '));setGenIdx(null);return;}

    // Phase 2: Pre-test (20)
    const preTest=await runPhase(`2/10 Pre-test (${sizing.pre})`,12,async()=>{
      const r=await callClaude(`${SYS}\n\n${TRANSFER}${CALIB}${DISTRIB}\n\n${sizing.pre} preguntas test (PRE-TEST) de "${targetTitle}". CONCEPTOS:\n${cMap}\n\nDistribuye: ${Math.round(sizing.pre*0.35)} fáciles, ${Math.round(sizing.pre*0.35)} medias, ${sizing.pre-Math.round(sizing.pre*0.35)*2} difíciles.\n\nJSON:\n{"questions":[{"id":"p1","question":"...","options":["A)...","B)...","C)...","D)..."],"correct":0,"explanation":"breve","tipo":"concepto","dificultad":"media"}]}`,8192);
      return JSON.parse(repairJSON(r));
    });

    // Phase 3: Guided reading
    const guided=await runPhase('3/10 Lectura guiada',25,async()=>{
      const r=await callClaude(`${SYS}\n\nLectura guiada de "${targetTitle}" (3-6 subsecciones). CONCEPTOS:\n${cMap}\n\nJSON:\n{"sections":[{"title":"...","summary":"...","keyPoints":["..."],"checkQuestion":{"question":"...","answer":"..."}}]}`,8192);
      return JSON.parse(repairJSON(r));
    });

    // Phase 4: Flashcards (25)
    const fc=await runPhase(`4/10 Flashcards (${sizing.fc})`,35,async()=>{
      const r=await callClaude(`${SYS}${DISTRIB}\n\n${sizing.fc} flashcards de "${targetTitle}". CONCEPTOS:\n${cMap}\n\nUna flashcard por concepto diferente.\n\nJSON:\n{"flashcards":[{"id":"f1","front":"Pregunta","back":"Respuesta","tipo":"concepto"}]}\n\n${sizing.fc} exactas.`,6144);
      return JSON.parse(repairJSON(r));
    });

    // Phase 5: Lab cases (5) — split into 3+2 to avoid truncation
    const cc=await runPhase(`5/10 Casos laboratorio (${sizing.cases})`,45,async()=>{
      const half1=Math.ceil(sizing.cases/2),half2=sizing.cases-half1;
      const r1=await callClaude(`${SYS}\n\n${half1} casos de laboratorio de "${targetTitle}". CONCEPTOS:\n${cMap}\n\nFormato: "Recibes una muestra con [valores con unidades]. ¿Patrón, interferencias, pruebas adicionales?" Cada caso sobre un concepto diferente.\n\nJSON:\n{"clinicalCases":[{"id":"c1","presentation":"Recibes...","question":"...","options":["A)...","B)...","C)...","D)..."],"correct":0,"discussion":"breve"}]}`,6144);
      const b1=JSON.parse(repairJSON(r1));
      if(half2>0){
        const r2=await callClaude(`${SYS}\n\n${half2} casos de laboratorio más de "${targetTitle}". CONCEPTOS:\n${cMap}\n\nMismo formato, conceptos diferentes a los anteriores.\n\nJSON:\n{"clinicalCases":[{"id":"c${half1+1}","presentation":"...","question":"...","options":["A)...","B)...","C)...","D)..."],"correct":0,"discussion":"breve"}]}`,4096);
        const b2=JSON.parse(repairJSON(r2));
        return{clinicalCases:[...(b1.clinicalCases||b1||[]),...(b2.clinicalCases||b2||[])]};
      }
      return b1;
    });

    // Phase 6: Fill blanks (5)
    const fb=await runPhase(`6/10 Completar blancos (${sizing.fb})`,55,async()=>{
      const r=await callClaude(`${SYS}${DISTRIB}\n\n${sizing.fb} preguntas completar blancos de "${targetTitle}". CONCEPTOS:\n${cMap}\n\nUna pregunta por concepto diferente.\n\nJSON:\n{"fillBlanks":[{"id":"fb1","sentence":"Frase con ___","answers":["respuesta"],"explanation":"breve"}]}`,4096);
      return JSON.parse(repairJSON(r));
    });

    // Phase 7: Diff diagnosis (2 pairs)
    const dd=await runPhase('7/10 Diagnóstico diferencial (2)',62,async()=>{
      const r=await callClaude(`${SYS}\n\n2 pares de diagnóstico diferencial de "${targetTitle}". CONCEPTOS:\n${cMap}\n\nCada par tiene dos casos con resultados analíticos similares pero con una diferencia clave. Para CADA caso genera exactamente 5 opciones diagnósticas:\n- 1 diagnóstico correcto\n- 2 diagnósticos que compartan algún hallazgo pero difieran en algo clave\n- 1 diagnóstico del mismo grupo pero con mecanismo diferente\n- 1 diagnóstico claramente incorrecto\n\nJSON:\n{"diffDiagnosis":[{"id":"d1","caseA":"Caso A: valores analíticos con unidades","caseB":"Caso B: valores similares con diferencia clave","optionsA":["Dx correcto A","Dx similar 1","Dx similar 2","Dx mismo grupo","Dx incorrecto"],"correctA":0,"optionsB":["Dx correcto B","Dx similar 1","Dx similar 2","Dx mismo grupo","Dx incorrecto"],"correctB":0,"explanation":"Caso A = diagnóstico X porque [hallazgo clave]. Caso B = diagnóstico Y porque [hallazgo diferenciador]. La clave que los distingue es..."}]}`,6144);
      return JSON.parse(repairJSON(r));
    });

    // Phase 8: Open questions (3)
    const oq=await runPhase('8/10 Preguntas abiertas (3)',70,async()=>{
      const r=await callClaude(`${SYS}\n\n3 preguntas respuesta abierta de "${targetTitle}". CONCEPTOS:\n${cMap}\n\nJSON:\n{"openQuestions":[{"id":"o1","question":"...","modelAnswer":"...","keyConcepts":["..."]}]}`,4096);
      return JSON.parse(repairJSON(r));
    });

    // Phase 9: Interactive question types — adaptive count
    const iSeq=Math.max(1,Math.round(sizing.inter*0.3)),iCl=Math.max(1,Math.round(sizing.inter*0.2)),iMatch=Math.max(1,Math.round(sizing.inter*0.2)),iErr=Math.max(1,Math.round(sizing.inter*0.15)),iProg=1,iPat=Math.max(1,Math.round(sizing.inter*0.15));
    const interactive=await runPhase(`10/14 Tipos interactivos (${sizing.inter})`,80,async()=>{
      const r=await callClaude(`${SYS}${DISTRIB}\n\nPreguntas interactivas de "${targetTitle}". CONCEPTOS:\n${cMap}\n\nJSON:\n{"sequences":[{"id":"s1","instruction":"Ordena los pasos","steps":["p1","p2","p3","p4"],"correctOrder":[0,1,2,3]}],"classifications":[{"id":"cl1","categories":["Cat A","Cat B"],"items":[{"text":"item","category":0}]}],"matching":[{"id":"m1","left":["término"],"right":["def"],"pairs":[[0,0]]}],"errors":[{"id":"e1","statement":"Afirmación","errorPart":"parte incorrecta","correction":"correcto","options":["A","B","C"]}],"progressiveCases":[{"id":"pc1","step1":{"info":"Datos","question":"¿?"},"step2":{"info":"Más datos","question":"¿?"},"step3":{"info":"Completo","question":"¿?"},"answer":"Dx"}],"patterns":[{"id":"pt1","results":"Tabla valores","options":["A","B","C","D"],"correct":0,"explanation":"breve"}]}\n\n${iSeq} secuencias, ${iCl} clasificaciones, ${iMatch} emparejamientos, ${iErr} errores, ${iProg} progresivo, ${iPat} patrones.`,8192);
      return JSON.parse(repairJSON(r));
    });

    // Phase 10: Post-test — adaptive count, split in 2
    const postHalf1=Math.ceil(sizing.post/2),postHalf2=sizing.post-postHalf1;
    const postTest=await runPhase(`11/14 Post-test (${postHalf1}+${postHalf2})`,88,async()=>{
      const base=`${SYS}\n\n${TRANSFER}${CALIB}${DISTRIB}\n\nPreguntas DIFÍCILES (POST-TEST) de "${targetTitle}". CONCEPTOS:\n${cMap}\n\nJSON:\n{"questions":[{"id":"p1","question":"...","options":["A)...","B)...","C)...","D)..."],"correct":0,"explanation":"breve","tipo":"aplicacion","dificultad":"alta"}]}`;
      const r1=await callClaude(base+`\n\n${postHalf1} preguntas exactas.`,8192);
      const b1=JSON.parse(repairJSON(r1));
      const q1=b1.questions||b1;
      setGenPct(92);
      const r2=await callClaude(base+`\n\n${postHalf2} preguntas diferentes.`,8192);
      const b2=JSON.parse(repairJSON(r2));
      const q2=b2.questions||b2;
      return{questions:[...(Array.isArray(q1)?q1:[]),...(Array.isArray(q2)?q2:[])]};
    });

    // ── Assemble and save whatever we got ──────────────────────────────────
    setGenPct(96);setGenStep('Guardando...');
    const tag=(arr,fase)=>(Array.isArray(arr)?arr:[]).map(q=>({...q,id:uid(),tema:topicTag,seccion:sec.title,subseccion:sub?.title||'',fase,fechaGeneracion:dateTag,tipo:q.tipo||'concepto',dificultad:q.dificultad||'media'}));
    const taggedPreTest=tag(preTest?.questions||preTest||[],'pretest');
    const taggedPostTest=tag(postTest?.questions||postTest||[],'posttest');
    const taggedFlashcards=(fc?.flashcards||fc||[]).map(f=>({...f,id:uid(),tema:topicTag,seccion:sec.title,subseccion:sub?.title||'',fase:'flashcard',fechaGeneracion:dateTag}));
    const taggedClinical=tag(cc?.clinicalCases||cc||[],'caso');

    const addDays=(d,n)=>{const r=new Date(d);r.setDate(r.getDate()+n);return r.toISOString().slice(0,10);};
    const generated={
      generatedAt:now.toISOString(),
      conceptMap:Array.isArray(conceptList)?conceptList:[],
      phases:{
        preTest:taggedPreTest,
        guidedReading:guided?.sections||guided||[],
        flashcards:taggedFlashcards,
        clinicalCases:taggedClinical,
        fillBlanks:fb?.fillBlanks||fb||[],
        diffDiagnosis:dd?.diffDiagnosis||dd||[],
        openQuestions:oq?.openQuestions||oq||[],
        interactive:interactive||{},
        postTest:taggedPostTest,
      },
      progress:{preTest:null,postTest:null,flashcardsDominated:null,flashcardsSm2:null,clinicalScore:null,fillBlanks:null,openQuestions:null},
      errors:errors.length?errors:undefined,
    };

    // Cross-topic connections
    const myNames=new Set((Array.isArray(conceptList)?conceptList:[]).map(c=>(c.t||'').toLowerCase()));
    const connections=[];
    if(allLearningData){Object.entries(allLearningData).forEach(([ot,od])=>{if(ot===topic||!od?.sections)return;od.sections.forEach(os=>{if(!os?.generated?.conceptMap)return;os.generated.conceptMap.forEach(c=>{const n=(c.t||'').toLowerCase();if(myNames.has(n)&&!connections.some(x=>x.concept===n&&x.topic===ot))connections.push({concept:c.t,topic:ot,section:os.title});});});});}
    if(connections.length)generated.connections=connections.slice(0,10);

    let updSections;
    if(subIdx!=null){const updSubs=(sec.subsections||[]).map((s,i)=>i===subIdx?{...s,generated}:s);updSections=sections.map((s,i)=>i===idx?{...s,subsections:updSubs}:s);}
    else{updSections=sections.map((s,i)=>i===idx?{...s,generated}:s);}
    // Schedule spaced reviews for this section
    let sr=data.spacedRepetition||{reviews:[]};
    if(!Array.isArray(sr.reviews))sr={reviews:[]};
    // Don't create duplicate reviews for same section
    const secId=sec.id||sec.title;
    const hasReviews=sr.reviews.some(r=>r.seccionId===secId);
    if(!hasReviews){
      const newReviews=scheduleReviews(now,topic,secId);
      newReviews.forEach(r=>r.seccionTitle=sec.title);
      sr={...sr,reviews:[...sr.reviews,...newReviews]};
    }
    await save({...data,sections:updSections,spacedRepetition:sr});

    if(errors.length){
      setGenError(`Completado con ${errors.length} error(es): ${errors.map(e=>e.split(':')[0]).join(', ')}. Las fases completadas se guardaron.`);
      console.warn('[OPELab] Completado con errores:',errors);
    }else{
      console.log('[OPELab] ✓ TODAS las fases completadas correctamente');
    }
    setGenStep('');setGenPct(100);
    setGenIdx(null);
  };

  // ── Save progress for a section or subsection's phase ───────────────────
  const saveSectionProgress=async(secIdx,key,value,subIdx)=>{
    if(subIdx!=null){
      // Update subsection progress
      const sec=sections[secIdx];const sub=sec?.subsections?.[subIdx];if(!sub?.generated)return;
      const newProg={...sub.generated.progress,[key]:value};
      const updSubs=(sec.subsections||[]).map((s,i)=>i===subIdx?{...s,generated:{...s.generated,progress:newProg}}:s);
      const updSections=sections.map((s,i)=>i===secIdx?{...s,subsections:updSubs}:s);
      await save({...data,sections:updSections});
    }else{
      const sec=sections[secIdx];if(!sec?.generated)return;
      const newProg={...sec.generated.progress,[key]:value};
      const updGen={...sec.generated,progress:newProg};
      const updSections=sections.map((s,i)=>i===secIdx?{...s,generated:updGen}:s);
      await save({...data,sections:updSections});
    }
  };

  // ── Subsection management ─────────────────────────────────────────────────
  const addSubsection=(secIdx,title)=>{
    if(!title?.trim())return;
    const sec=sections[secIdx];
    const subs=[...(sec.subsections||[]),{id:uid(),title:title.trim(),text:'',generated:null}];
    const updSections=sections.map((s,i)=>i===secIdx?{...s,subsections:subs}:s);
    save({...data,sections:updSections});
  };
  const removeSubsection=(secIdx,subIdx)=>{
    const sec=sections[secIdx];
    const subs=(sec.subsections||[]).filter((_,i)=>i!==subIdx);
    const updSections=sections.map((s,i)=>i===secIdx?{...s,subsections:subs}:s);
    save({...data,sections:updSections});
  };
  const updateSubsectionText=(secIdx,subIdx,text)=>{
    const sec=sections[secIdx];
    const subs=(sec.subsections||[]).map((s,i)=>i===subIdx?{...s,text}:s);
    const updSections=sections.map((s,i)=>i===secIdx?{...s,subsections:subs}:s);
    save({...data,sections:updSections});
  };

  // ── Global progress metrics ───────────────────────────────────────────────
  const ls=getLearningStatus(data);
  const phasesList=[
    {id:'preTest',label:'Pre-Test',icon:'📝',color:T.blue},
    {id:'guidedReading',label:'Lectura',icon:'📖',color:T.teal},
    {id:'flashcards',label:'Flashcards',icon:'🃏',color:T.green},
    {id:'clinicalCases',label:'Casos Lab',icon:'🔬',color:T.orange},
    {id:'fillBlanks',label:'Completar',icon:'✏️',color:T.purple},
    {id:'diffDiagnosis',label:'Diferencial',icon:'⚖️',color:T.amber},
    {id:'openQuestions',label:'Abiertas',icon:'💬',color:T.teal},
    {id:'interactive',label:'Interactivo',icon:'🎯',color:T.orange},
    {id:'postTest',label:'Post-Test',icon:'✅',color:T.red},
    {id:'spacedRepetition',label:'Repaso',icon:'📅',color:T.blue},
  ];

  return(
    <div>
      {/* Global progress panel */}
      <Card style={{padding:'16px 20px',marginBottom:16}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
          <div style={{fontSize:15,fontWeight:700,color:T.text}}>🧠 Aprendizaje interactivo</div>
          <div style={{display:'flex',gap:10,alignItems:'center'}}>
            <span style={{fontSize:12,color:T.muted}}>{ls.generated||0} de {ls.total||sections.length} secciones</span>
            {ls.mastery>0&&<span style={{fontSize:13,fontWeight:700,color:ls.color}}>{ls.mastery}%</span>}
          </div>
        </div>
        {sections.length>0&&<PBar pct={ls.coverage} color={ls.color}/>}
        {sections.length===0&&<div style={{fontSize:12,color:T.muted,lineHeight:1.6}}>Añade secciones del tema y pega el texto de cada una. Cada sección genera sus propias fases de aprendizaje.</div>}
        {sections.some(s=>s.generated)&&!data.notes?.length&&(
          <div style={{marginTop:8,fontSize:11,color:T.teal}}>Genera apuntes del tema desde la pestaña Apuntes para sintetizar todo el contenido.</div>
        )}
      </Card>

      {/* Section accordions */}
      <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
        {sections.map((sec,idx)=>{
          const isOpen=openSec===idx;
          const isGen=genIdx===idx;
          const hasGen=!!sec.generated;
          const score=calcSectionScore(sec);
          const scoreColor=score===null?T.dim:score>=80?T.green:score>=60?T.amber:T.red;
          const curPhase=activePhase[idx]||0;

          return(
            <Card key={sec.id||idx} style={{overflow:'hidden',border:isGen?`1px solid ${T.purple}`:dragOverIdx===idx?`1px solid ${T.green}`:undefined,opacity:dragIdx===idx?0.4:1,transition:'opacity 0.15s, border-color 0.15s'}}
              draggable onDragStart={e=>{setDragIdx(idx);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(idx));}}
              onDragEnd={()=>{setDragIdx(null);setDragOverIdx(null);}}
              onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='move';if(dragIdx!==null&&dragIdx!==idx)setDragOverIdx(idx);}}
              onDragLeave={()=>setDragOverIdx(prev=>prev===idx?null:prev)}
              onDrop={e=>{e.preventDefault();const from=parseInt(e.dataTransfer.getData('text/plain'));if(!isNaN(from))reorderSections(from,idx);setDragIdx(null);setDragOverIdx(null);}}>
              {/* Section header */}
              <div onClick={()=>setOpenSec(isOpen?null:idx)}
                style={{padding:'12px 16px',cursor:'pointer',display:'flex',alignItems:'center',gap:10,background:isOpen?(hasGen?T.purpleS:T.card):T.surface}}>
                <span style={{cursor:'grab',color:T.dim,fontSize:12,flexShrink:0,padding:'0 2px',userSelect:'none'}} title="Arrastra para reordenar">⠿</span>
                <span style={{width:10,height:10,borderRadius:'50%',background:scoreColor,flexShrink:0,border:score===null?`2px solid ${T.border}`:'none'}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:T.text}}>{sec.title}</div>
                  <div style={{fontSize:10,color:T.muted}}>
                    {hasGen?`Generado · ${sec.generated.conceptMap?.length||0} conceptos`:sec.text?.trim()?'Texto pegado — listo para generar':'Sin generar'}
                    {score!==null&&<span style={{color:scoreColor,fontWeight:700}}> · {score}%</span>}
                    {sec.pageStart&&<span style={{color:T.dim}}> · pp.{sec.pageStart}{sec.pageEnd?'-'+sec.pageEnd:''}</span>}
                  </div>
                </div>
                {isGen&&<span style={{fontSize:10,color:T.purple,fontWeight:600,background:T.purpleS,padding:'2px 8px',borderRadius:10}}>⏳ {genStep}</span>}
                <button onClick={e=>{e.stopPropagation();removeSection(idx);}} style={{background:'none',border:'none',cursor:'pointer',color:T.dim,fontSize:16,padding:'0 4px'}}>×</button>
                <span style={{color:T.dim,fontSize:16,transform:isOpen?'rotate(90deg)':'none',transition:'transform 0.2s'}}>›</span>
              </div>

              {/* Expanded section content */}
              {isOpen&&(
                <div style={{borderTop:`1px solid ${T.border}`,padding:'14px 16px'}}>
                  {/* Section-level content: text + generate */}
                  {!hasGen&&(
                    <div style={{marginBottom:(sec.subsections||[]).length?12:0}}>
                      <div style={{marginBottom:10}}>
                        <textarea value={sec.text||''} onChange={e=>updateSectionText(idx,e.target.value)}
                          placeholder="Pega el texto de esta sección..."
                          style={{width:'100%',minHeight:80,background:T.card,color:T.text,border:`0.5px solid ${T.border}`,borderRadius:8,padding:'8px 10px',fontSize:11,fontFamily:FONT,resize:'vertical',outline:'none',boxSizing:'border-box'}}/>
                      </div>
                      {/* Generate button */}
                      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                        <button onClick={()=>generateSection(idx)} disabled={genIdx!=null||!sec.text?.trim()}
                          style={{background:genIdx===idx?T.amberS:!sec.text?.trim()?T.surface:T.purple,color:genIdx===idx?T.amberText:!sec.text?.trim()?T.dim:'#000',border:'none',borderRadius:8,padding:'8px 20px',fontSize:12,fontWeight:600,cursor:genIdx!=null||!sec.text?.trim()?'not-allowed':'pointer',fontFamily:FONT}}>
                          {genIdx===idx?`⏳ ${genStep}`:!sec.text?.trim()?'Pega texto primero':'🧠 Generar aprendizaje'}
                        </button>
                        {(()=>{const txt=sec.text||'';const wc=txt.split(/\s+/).length;if(wc<10)return null;const sz=wc<=1500?{t:'25-30',p:8,f:10,c:2}:wc<=4000?{t:'40-45',p:12,f:15,c:3}:wc<=8000?{t:'55-65',p:18,f:20,c:4}:{t:'75-90',p:20,f:25,c:5};return <span style={{fontSize:10,color:T.muted}}>{wc} pal · ~{sz.t} min · {sz.p} preg · {sz.f} FC · {sz.c} casos</span>;})()}
                      </div>
                      {genIdx===idx&&genPct>0&&<div style={{marginTop:8}}><PBar pct={genPct} color={T.purple} height={3}/></div>}
                      {genError&&(genIdx===idx||genIdx===null)&&<div style={{marginTop:6,fontSize:11,color:T.red,background:T.redS,padding:'6px 10px',borderRadius:6}}>{genError}</div>}
                    </div>
                  )}

                  {/* Generated section phases */}
                  {hasGen&&<SectionPhasesUI gen={sec.generated} idx={idx} subIdx={null} phasesList={phasesList} curPhase={curPhase} setActivePhase={setActivePhase} saveSectionProgress={saveSectionProgress} save={save} data={data} sections={sections} topic={topic} saveLearningData={saveLearningData}/>}

                  {/* Subsections */}
                  {(sec.subsections||[]).length>0&&(
                    <div style={{marginTop:12,borderTop:`1px solid ${T.border}`,paddingTop:12}}>
                      <div style={{fontSize:11,fontWeight:700,color:T.muted,marginBottom:8,textTransform:'uppercase',letterSpacing:0.5}}>Subsecciones</div>
                      {sec.subsections.map((sub,si)=>{
                        const subGenKey=`${idx}-${si}`;
                        const subHasGen=!!sub.generated;
                        const subScore=calcUnitScore(sub);
                        const subColor=subScore===null?T.dim:subScore>=80?T.green:subScore>=60?T.amber:T.red;
                        const subPhase=activePhase[subGenKey]||0;
                        return(
                          <div key={sub.id||si} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,marginBottom:6,overflow:'hidden'}}>
                            <div style={{padding:'8px 12px',display:'flex',alignItems:'center',gap:8}}>
                              <span style={{width:7,height:7,borderRadius:'50%',background:subColor,flexShrink:0}}/>
                              <span style={{fontSize:12,fontWeight:600,color:T.text,flex:1}}>{sub.title}</span>
                              {subScore!==null&&<span style={{fontSize:10,fontWeight:700,color:subColor}}>{subScore}%</span>}
                              <button onClick={()=>removeSubsection(idx,si)} style={{background:'none',border:'none',cursor:'pointer',color:T.dim,fontSize:14}}>×</button>
                            </div>
                            {!subHasGen&&(
                              <div style={{padding:'8px 12px',borderTop:`1px solid ${T.border}`}}>
                                <textarea value={sub.text||''} onChange={e=>updateSubsectionText(idx,si,e.target.value)} placeholder="Texto de la subsección..."
                                  style={{width:'100%',minHeight:80,background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:6,padding:'8px',fontSize:11,fontFamily:FONT,resize:'vertical',outline:'none',boxSizing:'border-box',marginBottom:6}}/>
                                <button onClick={()=>generateSection(idx,si)} disabled={genIdx!=null||!sub.text?.trim()}
                                  style={{background:genIdx===subGenKey?T.amberS:(!sub.text?.trim()?T.card:T.teal),color:genIdx===subGenKey?T.amberText:(!sub.text?.trim()?T.dim:'#fff'),border:'none',borderRadius:6,padding:'5px 14px',fontSize:11,fontWeight:600,cursor:genIdx!=null||!sub.text?.trim()?'not-allowed':'pointer',fontFamily:FONT}}>
                                  {genIdx===subGenKey?`⏳ ${genStep}`:'🧠 Generar'}
                                </button>
                                {genIdx===subGenKey&&<div style={{marginTop:6}}><div style={{background:T.border,borderRadius:3,height:3}}><div style={{background:T.teal,width:`${genPct}%`,height:'100%',borderRadius:3,transition:'width 0.3s'}}/></div></div>}
                              </div>
                            )}
                            {subHasGen&&<div style={{padding:'8px 12px',borderTop:`1px solid ${T.border}`}}><SectionPhasesUI gen={sub.generated} idx={idx} subIdx={si} phasesList={phasesList} curPhase={subPhase} setActivePhase={setActivePhase} saveSectionProgress={saveSectionProgress} save={save} data={data} sections={sections} topic={topic} saveLearningData={saveLearningData} phaseKey={subGenKey}/></div>}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Add subsection */}
                  <div style={{marginTop:8,display:'flex',gap:6}}>
                    <input placeholder="Título de subsección..." onKeyDown={e=>{if(e.key==='Enter'&&e.target.value.trim()){addSubsection(idx,e.target.value);e.target.value='';}}}
                      style={{flex:1,background:T.card,color:T.text,border:`1px solid ${T.border}`,borderRadius:6,padding:'5px 10px',fontSize:11,outline:'none',fontFamily:FONT}}/>
                    <button onClick={e=>{const inp=e.currentTarget.previousSibling;if(inp.value.trim()){addSubsection(idx,inp.value);inp.value='';}}}
                      style={{background:T.tealS,border:`1px solid ${T.teal}`,borderRadius:6,padding:'5px 10px',fontSize:10,cursor:'pointer',color:T.tealText,fontWeight:600,fontFamily:FONT,whiteSpace:'nowrap'}}>+ Subsección</button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Add section */}
      <Card style={{padding:'14px 16px'}}>
        <div style={{display:'flex',gap:8,marginBottom:8}}>
          <input value={newTitle} onChange={e=>setNewTitle(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addSection()}
            placeholder="Título de la nueva sección (ej: Fisiología, Métodos analíticos, Patología...)"
            style={{flex:1,background:T.card,color:T.text,border:`1px solid ${T.border}`,borderRadius:7,padding:'8px 12px',fontSize:12,outline:'none',fontFamily:FONT}}/>
          <button onClick={addSection} disabled={!newTitle.trim()}
            style={{background:!newTitle.trim()?T.card:T.purple,color:!newTitle.trim()?T.dim:'#fff',border:'none',borderRadius:7,padding:'8px 18px',fontSize:12,fontWeight:600,cursor:!newTitle.trim()?'not-allowed':'pointer',fontFamily:FONT,whiteSpace:'nowrap'}}>
            + Añadir sección
          </button>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <button onClick={extractSectionsFromPdf} disabled={extracting}
            style={{background:extracting?T.amberS:T.tealS,border:`1px solid ${extracting?T.amber:T.teal}`,borderRadius:7,padding:'6px 14px',fontSize:11,fontWeight:600,cursor:extracting?'wait':'pointer',color:extracting?T.amberText:T.tealText,fontFamily:FONT}}>
            {extracting?'⏳ Extrayendo...':'📄 Extraer secciones del PDF'}
          </button>
          {extractMsg&&<span style={{fontSize:11,color:extractMsg.startsWith('✓')?T.green:extractMsg.startsWith('Error')?T.red:T.muted}}>{extractMsg}</span>}
        </div>
      </Card>
    </div>
  );
}

// ── Section Phases UI — reusable for sections and subsections ────────────────
function SectionPhasesUI({gen,idx,subIdx,phasesList,curPhase,setActivePhase,saveSectionProgress,save,data,sections,topic,saveLearningData,phaseKey}){
  const pKey=phaseKey||idx;
  const onSaveProg=(key,val)=>saveSectionProgress(idx,key,val,subIdx);

  // ── Session timer — persists across unmount/remount via global Map ───────
  const timerKey=`${topic}::${subIdx!=null?`${idx}-${subIdx}`:idx}`;
  const postTestDone=gen.progress?.postTest?.completed;

  // Initialize global timer entry on first mount (or restore existing)
  if(!_sessionTimers.has(timerKey)){
    const saved=gen.progress?.sessionTime||0;
    _sessionTimers.set(timerKey,{startTs:Date.now()-saved*1000,pausedAt:null,accumulated:0});
  }

  const getElapsed=()=>{
    const t=_sessionTimers.get(timerKey);
    if(!t)return 0;
    if(postTestDone)return gen.progress?.sessionTime||Math.floor((Date.now()-t.startTs-t.accumulated)/1000);
    if(t.pausedAt)return Math.floor((t.pausedAt-t.startTs-t.accumulated)/1000);
    return Math.floor((Date.now()-t.startTs-t.accumulated)/1000);
  };

  const [elapsed,setElapsed]=useState(getElapsed);
  const timerRef=useRef(null);

  useEffect(()=>{
    if(postTestDone){setElapsed(getElapsed());return;}
    const tick=()=>setElapsed(getElapsed());
    timerRef.current=setInterval(tick,1000);
    const onVis=()=>{
      const t=_sessionTimers.get(timerKey);if(!t)return;
      if(document.hidden){
        clearInterval(timerRef.current);
        t.pausedAt=Date.now();
      }else{
        if(t.pausedAt){t.accumulated+=(Date.now()-t.pausedAt);t.pausedAt=null;}
        timerRef.current=setInterval(tick,1000);
      }
    };
    document.addEventListener('visibilitychange',onVis);
    return()=>{clearInterval(timerRef.current);document.removeEventListener('visibilitychange',onVis);};
  },[postTestDone,timerKey]);

  // Save time when posttest completes
  const savedTimeRef=useRef(false);
  useEffect(()=>{
    if(!postTestDone||savedTimeRef.current)return;
    savedTimeRef.current=true;
    const finalElapsed=getElapsed();
    const sec=sections[idx];if(!sec?.generated)return;
    const timeKey=`study_time_${topic.replace(/[^a-z0-9]/gi,'').slice(0,30)}_${sec.id||sec.title}`;
    const prev=load(timeKey,[]);
    prev.push({seconds:finalElapsed,date:new Date().toISOString()});
    save(timeKey,prev);
    onSaveProg('sessionTime',finalElapsed);
    _sessionTimers.delete(timerKey); // Clean up — session is done
  },[postTestDone]);

  const fmtTimer=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

  return(
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{fontSize:10,color:T.muted}}>Generado el {fmtDate(gen.generatedAt)} · {gen.conceptMap?.length||0} conceptos</div>
          <span style={{fontSize:11,fontWeight:600,color:T.teal,fontVariantNumeric:'tabular-nums'}}>⏱ {fmtTimer(elapsed)}</span>
        </div>
        <button onClick={()=>{
          if(subIdx!=null){const sec=sections[idx];const subs=(sec.subsections||[]).map((s,i)=>i===subIdx?{...s,generated:null}:s);const upd=sections.map((s,i)=>i===idx?{...s,subsections:subs}:s);save({...data,sections:upd});}
          else{const upd=sections.map((s,i)=>i===idx?{...s,generated:null}:s);save({...data,sections:upd});}
        }} style={{fontSize:10,background:'none',border:`1px solid ${T.border}`,borderRadius:5,padding:'2px 8px',cursor:'pointer',color:T.muted,fontFamily:FONT}}>🔄 Regenerar</button>
      </div>
      <div style={{display:'flex',gap:3,marginBottom:10,flexWrap:'wrap'}}>
        {phasesList.map((p,pi)=>(
          <button key={p.id} onClick={()=>setActivePhase(prev=>({...prev,[pKey]:pi}))}
            style={{padding:'3px 8px',fontSize:9,fontWeight:curPhase===pi?700:500,color:curPhase===pi?p.color:T.muted,background:curPhase===pi?p.color+'15':T.card,border:`1px solid ${curPhase===pi?p.color:T.border}`,borderRadius:5,cursor:'pointer',fontFamily:FONT}}>
            {p.icon} {p.label}
          </button>
        ))}
      </div>
      {curPhase===0&&<QuizPhase questions={gen.phases.preTest} title="Pre-Test (20)" progress={gen.progress?.preTest} onSaveProgress={p=>onSaveProg('preTest',p)} color={T.blue}/>}
      {curPhase===1&&<GuidedReadingPhase sections={gen.phases.guidedReading}/>}
      {curPhase===2&&<FlashcardsPhase cards={gen.phases.flashcards} onDominatedChange={count=>onSaveProg('flashcardsDominated',count)} onSm2Update={d=>onSaveProg('flashcardsSm2',d)}/>}
      {curPhase===3&&<ClinicalCasesPhase cases={gen.phases.clinicalCases} onScoreChange={score=>onSaveProg('clinicalScore',score)}/>}
      {curPhase===4&&<FillBlanksPhase items={gen.phases.fillBlanks||[]} progress={gen.progress?.fillBlanks} onSaveProgress={p=>onSaveProg('fillBlanks',p)}/>}
      {curPhase===5&&<DiffDiagnosisPhase pairs={gen.phases.diffDiagnosis||[]}/>}
      {curPhase===6&&<OpenQuestionsPhase questions={gen.phases.openQuestions||[]} progress={gen.progress?.openQuestions} onSaveProgress={p=>onSaveProg('openQuestions',p)}/>}
      {curPhase===7&&<InteractiveQuestionsPhase data={gen.phases.interactive||{}}/>}
      {curPhase===8&&(
        <div>
          <QuizPhase questions={gen.phases.postTest} title="Post-Test (25)" progress={gen.progress?.postTest} onSaveProgress={p=>onSaveProg('postTest',p)} color={T.red} isPostTest={true}/>
          {gen.progress?.preTest?.completed&&gen.progress?.postTest?.completed&&(()=>{
            const ss=calcSessionScore(gen,elapsed);
            const lvl=getMasteryLevel(ss.score);
            // Save mastery to section progress (one-time)
            if(!gen.progress.mastery&&ss.score>0){onSaveProg('mastery',ss.score);
              // Save session history
              const histKey=`session_hist_${topic.replace(/[^a-z0-9]/gi,'').slice(0,30)}_${sections[idx]?.id||''}`;
              const hist=load(histKey,[]);
              hist.push({date:new Date().toISOString(),score:ss.score,breakdown:ss.breakdown,mods:ss.mods,elapsed,preTest:gen.progress.preTest.score,postTest:gen.progress.postTest.score});
              save(histKey,hist);
            }
            const prevSession=(()=>{const hk=`session_hist_${topic.replace(/[^a-z0-9]/gi,'').slice(0,30)}_${sections[idx]?.id||''}`;const h=load(hk,[]);return h.length>1?h[h.length-2]:null;})();
            return(
            <Card style={{padding:'18px 22px',marginTop:14,borderLeft:`3px solid ${T.green}`,animation:'fadeIn 250ms ease-in-out'}}>
              <div style={{fontSize:13,fontWeight:700,color:T.text,marginBottom:10}}>📊 Resumen de sesión</div>
              {/* Main score */}
              <div style={{display:'flex',alignItems:'center',gap:16,marginBottom:12}}>
                <div style={{textAlign:'center'}}>
                  <div style={{fontSize:36,fontWeight:700,color:lvl.color}}>{ss.score}</div>
                  <div style={{fontSize:11,color:T.muted}}>Puntuación</div>
                  <div style={{fontSize:10,fontWeight:700,color:lvl.color}}>{lvl.emoji} {lvl.name}</div>
                </div>
                <div style={{flex:1,display:'flex',flexDirection:'column',gap:3}}>
                  {/* Breakdown bars */}
                  {[{k:'postTest',l:'Post-test',max:35},{k:'flashcards',l:'Flashcards',max:25},{k:'clinical',l:'Casos',max:20},{k:'interactive',l:'Interactivo',max:15},{k:'fillBlanks',l:'Completar',max:5}].map(b=>(
                    <div key={b.k} style={{display:'flex',alignItems:'center',gap:6}}>
                      <span style={{fontSize:9,color:T.dim,minWidth:60}}>{b.l}</span>
                      <div style={{flex:1,height:4,background:T.border,borderRadius:2}}><div style={{width:`${(ss.breakdown[b.k]||0)/b.max*100}%`,height:'100%',background:T.teal,borderRadius:2,transition:'width 0.5s'}}/></div>
                      <span style={{fontSize:9,fontWeight:700,color:T.text,minWidth:20,textAlign:'right'}}>{ss.breakdown[b.k]||0}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Pre vs Post */}
              <div style={{display:'flex',gap:14,alignItems:'center',marginBottom:8}}>
                <span style={{fontSize:14,fontWeight:700,color:T.blue}}>{gen.progress.preTest.score}%</span>
                <span style={{color:T.dim}}>→</span>
                <span style={{fontSize:14,fontWeight:700,color:T.green}}>{gen.progress.postTest.score}%</span>
                <span style={{fontSize:12,fontWeight:700,color:gen.progress.postTest.score>gen.progress.preTest.score?T.green:T.red}}>
                  {gen.progress.postTest.score>gen.progress.preTest.score?'+':''}{gen.progress.postTest.score-gen.progress.preTest.score}%
                </span>
                <span style={{fontSize:12,fontWeight:600,color:T.teal,marginLeft:'auto'}}>⏱ {fmtTimer(elapsed)}</span>
              </div>
              {/* Modifiers */}
              {ss.mods.length>0&&<div style={{marginBottom:8}}>{ss.mods.map((m,i)=>(
                <div key={i} style={{fontSize:10,color:m.value>0?T.green:T.red}}>{m.value>0?'+':''}{m.value} · {m.detail}</div>
              ))}</div>}
              {/* Previous session comparison */}
              {prevSession&&<div style={{fontSize:11,color:T.muted}}>Sesión anterior: {prevSession.score} puntos {ss.score>prevSession.score?<span style={{color:T.green}}>· ↑{ss.score-prevSession.score}</span>:<span style={{color:T.red}}>· ↓{prevSession.score-ss.score}</span>}</div>}
              {/* Time comparison */}
              {(()=>{const sec=sections[idx];const tk=`study_time_${topic.replace(/[^a-z0-9]/gi,'').slice(0,30)}_${sec?.id||sec?.title||''}`;const prev=load(tk,[]);if(prev.length>1){const avg=Math.round(prev.reduce((a,s)=>a+s.seconds,0)/prev.length);return <div style={{fontSize:10,color:T.dim}}>Media tiempo: {fmtTimer(avg)} {elapsed<avg?'· ¡Más rápido!':`· ${Math.round((elapsed/avg-1)*100)}% más`}</div>;}return null;})()}
            </Card>);})()}
          )}
        </div>
      )}
      {curPhase===9&&data.spacedRepetition&&<SpacedRepetitionPhase schedule={data.spacedRepetition} topic={topic} learning={data} saveLearningData={saveLearningData}/>}
      {/* Cross-topic connections */}
      {gen.connections&&gen.connections.length>0&&(
        <Card style={{padding:'12px 16px',marginTop:12}}>
          <div style={{fontSize:11,fontWeight:700,color:T.teal,marginBottom:6}}>🔗 Conectado con</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
            {gen.connections.map((c,i)=>(
              <span key={i} style={{fontSize:10,background:T.tealS,color:T.tealText,padding:'2px 8px',borderRadius:6,border:`0.5px solid ${T.teal}`,cursor:'pointer'}} title={c.concept}>{c.topic} · {c.section}</span>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Quiz Phase (Pre-Test / Post-Test) ───────────────────────────────────────
function QuizPhase({questions,title,progress,onSaveProgress,color,isPostTest,prediction,onPrediction}){
  const [current,setCurrent]=useState(0);
  const [answers,setAnswers]=useState(progress?.answers||{});
  const [showResult,setShowResult]=useState(!!progress?.completed);
  const [revealed,setRevealed]=useState({});
  const [certainty,setCertainty]=useState(progress?.certainty||{}); // {qIdx: 'seguro'|'dudoso'|'adivinando'}
  const [predSlider,setPredSlider]=useState(prediction||5);
  const [predSet,setPredSet]=useState(!!progress?.completed);

  if(!Array.isArray(questions)||questions.length===0) return <div style={{color:T.dim,textAlign:'center',padding:40}}>No hay preguntas disponibles.</div>;

  // Pedagogical intro texts
  const introText=title.includes('Pre-Test')
    ?'Responde antes de estudiar — aunque no sepas, tu cerebro entrará en modo búsqueda activa y retendrá mejor lo que leas a continuación.'
    :title.includes('Post-Test')
    ?'Evalúa tu comprensión real — las preguntas son de aplicación en contexto nuevo para medir si realmente has integrado el conocimiento.'
    :null;

  const total=questions.length;
  const answered=Object.keys(answers).length;
  const correct=Object.entries(answers).filter(([i,a])=>a===questions[parseInt(i)]?.correct).length;

  // Certainty analysis
  const certAnalysis=useMemo(()=>{
    const r={solid:0,blindSpot:0,unstable:0,lucky:0};
    Object.entries(answers).forEach(([i,a])=>{
      const ok=a===questions[parseInt(i)]?.correct;
      const cert=certainty[i];
      if(cert==='seguro'&&ok)r.solid++;
      else if(cert==='seguro'&&!ok)r.blindSpot++;
      else if(cert==='dudoso'&&ok)r.unstable++;
      else if(cert==='adivinando'&&ok)r.lucky++;
    });
    return r;
  },[answers,certainty,questions]);

  const finish=()=>{
    const score=Math.round(correct/total*100);
    setShowResult(true);
    // Save certainty data with progress
    const certData={certainty,analysis:certAnalysis};
    onSaveProgress?.({answers,completed:true,score,correct,total,...certData,prediction:isPostTest?predSlider:undefined});
    // Save certainty history to localStorage
    const hist=load('olab_certainty_hist',[]);
    Object.entries(certainty).forEach(([i,c])=>{
      const q=questions[parseInt(i)];if(!q)return;
      hist.push({qId:q.id,certainty:c,correct:answers[i]===q.correct,date:new Date().toISOString().slice(0,10),tipo:q.tipo});
    });
    save('olab_certainty_hist',hist.slice(-500));
  };

  // Prediction screen for post-test
  if(isPostTest&&!predSet&&!progress?.completed) return(
    <Card style={{padding:'28px',textAlign:'center'}}>
      <div style={{fontSize:18,fontWeight:700,color:T.text,marginBottom:8}}>¿Qué nota esperas?</div>
      <div style={{fontSize:12,color:T.dim,marginBottom:16,lineHeight:1.6,maxWidth:400,margin:'0 auto 16px'}}>Predice tu resultado antes de empezar. Compararemos tu predicción con el resultado real.</div>
      <div style={{fontSize:48,fontWeight:700,color:T.amber,marginBottom:8}}>{predSlider}</div>
      <input type="range" min={0} max={10} step={0.5} value={predSlider} onChange={e=>setPredSlider(parseFloat(e.target.value))} style={{width:'80%',maxWidth:300,accentColor:T.amber,marginBottom:16}}/>
      <div><button onClick={()=>{setPredSet(true);onPrediction?.(predSlider);}} style={{background:T.amber,color:'#fff',border:'none',borderRadius:8,padding:'10px 24px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:FONT}}>Empezar Post-Test →</button></div>
    </Card>
  );

  if(showResult){
    const pct=Math.round(correct/total*100);
    const nota10=(correct/total*10).toFixed(1);
    return(
      <Card style={{padding:'24px',textAlign:'center'}}>
        <div style={{fontSize:48,marginBottom:12}}>{pct>=70?'🎉':pct>=50?'💪':'📚'}</div>
        <div style={{fontSize:22,fontWeight:700,color:pct>=70?T.green:pct>=50?T.amber:T.red}}>{pct}%</div>
        <div style={{fontSize:14,color:T.text,marginBottom:4}}>{correct} de {total} correctas</div>
        <div style={{fontSize:12,color:T.muted,marginBottom:12}}>{title}</div>
        {/* Prediction comparison for post-test */}
        {isPostTest&&predSlider!=null&&(
          <div style={{background:T.surface,border:`0.5px solid ${T.border}`,borderRadius:8,padding:'12px 16px',marginBottom:12,display:'inline-block'}}>
            <div style={{display:'flex',gap:16,alignItems:'center',justifyContent:'center'}}>
              <div><div style={{fontSize:18,fontWeight:700,color:T.amber}}>{predSlider}</div><div style={{fontSize:10,color:T.dim}}>Predicción</div></div>
              <span style={{color:T.dim}}>vs</span>
              <div><div style={{fontSize:18,fontWeight:700,color:pct>=70?T.green:T.red}}>{nota10}</div><div style={{fontSize:10,color:T.dim}}>Real</div></div>
            </div>
            {predSlider-parseFloat(nota10)>2&&<div style={{fontSize:11,color:T.amber,marginTop:6}}>⚠ Tiendes a sobreestimar tu dominio — repasa antes de dar un tema por aprendido</div>}
          </div>
        )}
        {/* Certainty analysis */}
        {(certAnalysis.blindSpot>0||certAnalysis.unstable>0)&&(
          <div style={{marginBottom:12,fontSize:11,textAlign:'left',background:T.bg,borderRadius:8,padding:'10px 14px',border:`0.5px solid ${T.border}`}}>
            {certAnalysis.solid>0&&<div style={{color:T.green}}>✓ {certAnalysis.solid} sólidas (seguro + acierto)</div>}
            {certAnalysis.blindSpot>0&&<div style={{color:T.red}}>⚠ {certAnalysis.blindSpot} puntos ciegos (seguro + fallo)</div>}
            {certAnalysis.unstable>0&&<div style={{color:T.amber}}>~ {certAnalysis.unstable} inestables (dudoso + acierto)</div>}
            {certAnalysis.lucky>0&&<div style={{color:T.dim}}>🎲 {certAnalysis.lucky} suerte (adivinando + acierto)</div>}
          </div>
        )}
        <button onClick={()=>{setAnswers({});setShowResult(false);setCurrent(0);setRevealed({});setCertainty({});setPredSet(false);onSaveProgress?.(null);}} style={{background:T.card,border:`0.5px solid ${T.border}`,borderRadius:7,padding:'8px 18px',fontSize:12,cursor:'pointer',color:T.muted,fontFamily:FONT}}>🔄 Repetir</button>
      </Card>
    );
  }

  const q=questions[current];if(!q)return null;
  const isRevealed=revealed[current];
  const hasCertainty=certainty[current]!=null;

  return(
    <div>
      {introText&&current===0&&!Object.keys(answers).length&&(
        <div style={{marginBottom:12,padding:'10px 14px',background:T.surface,borderRadius:8,border:`0.5px solid ${T.border}`,borderLeft:`2px solid ${color||T.blue}`}}>
          <div style={{fontSize:11,color:T.muted,lineHeight:1.6}}>{introText}</div>
        </div>
      )}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <span style={{fontSize:13,fontWeight:600,color:T.text}}>{title} — {current+1}/{total}</span>
        <span style={{fontSize:12,color:T.muted}}>{answered}/{total}</span>
      </div>
      <PBar pct={answered/total*100} color={color||T.blue} height={3}/>
      <Card style={{padding:'18px',marginTop:10}}>
        <div style={{fontSize:13,color:T.text,lineHeight:1.7,marginBottom:14,fontWeight:500}}>{q.question}</div>
        {/* Certainty selector — before answering */}
        {!isRevealed&&!hasCertainty&&(
          <div style={{marginBottom:12,padding:'8px 12px',background:T.bg,borderRadius:8,border:`0.5px solid ${T.border}`}}>
            <div style={{fontSize:10,color:T.dim,marginBottom:6}}>Marca tu certeza antes de responder — detecta puntos ciegos</div>
            <div style={{display:'flex',gap:6}}>
              {[{v:'seguro',l:'Seguro',c:T.green},{v:'dudoso',l:'Dudoso',c:T.amber},{v:'adivinando',l:'Adivinando',c:T.red}].map(({v,l,c})=>(
                <button key={v} onClick={()=>setCertainty(prev=>({...prev,[current]:v}))}
                  style={{flex:1,padding:'5px 8px',fontSize:11,borderRadius:6,cursor:'pointer',background:c+'15',border:`0.5px solid ${c}`,color:c,fontWeight:600,fontFamily:FONT}}>{l}</button>
              ))}
            </div>
          </div>
        )}
        {hasCertainty&&!isRevealed&&<div style={{fontSize:10,color:T.dim,marginBottom:8}}>Certeza: {certainty[current]}</div>}
        {/* Options */}
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {(q.options||[]).map((opt,j)=>{
            const isSel=answers[current]===j;const isOk=j===q.correct;
            let bg=T.card,bdr=T.border,col=T.text;
            if(isRevealed&&isOk){bg=T.greenS;bdr=T.green;col=T.greenText;}
            else if(isRevealed&&isSel&&!isOk){bg=T.redS;bdr=T.red;col=T.redText;}
            else if(isSel){bg=T.blueS;bdr=T.blue;col=T.blueText;}
            return <button key={j} onClick={()=>{if(!isRevealed&&hasCertainty){setAnswers(prev=>({...prev,[current]:j}));setRevealed(prev=>({...prev,[current]:true}));}}}
              disabled={isRevealed||!hasCertainty} style={{background:bg,border:`0.5px solid ${bdr}`,borderRadius:8,padding:'9px 12px',fontSize:12,textAlign:'left',cursor:isRevealed||!hasCertainty?'default':'pointer',color:col,fontFamily:FONT,opacity:!hasCertainty?0.5:1}}>{opt}</button>;
          })}
        </div>
        {isRevealed&&q.explanation&&(
          <div style={{marginTop:10,padding:'8px 12px',background:T.blueS,borderRadius:8,fontSize:11,color:T.blueText,lineHeight:1.6,borderLeft:`2px solid ${T.blue}`}}>💡 {q.explanation}</div>
        )}
        <div style={{display:'flex',justifyContent:'space-between',marginTop:14}}>
          <button onClick={()=>setCurrent(Math.max(0,current-1))} disabled={current===0} style={{background:'none',border:`0.5px solid ${T.border}`,borderRadius:6,padding:'5px 12px',fontSize:12,cursor:current===0?'not-allowed':'pointer',color:T.muted,fontFamily:FONT}}>←</button>
          {current===total-1&&answered>=total
            ?<button onClick={finish} style={{background:color||T.blue,color:'#fff',border:'none',borderRadius:6,padding:'5px 16px',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:FONT}}>Ver resultado</button>
            :<button onClick={()=>setCurrent(Math.min(total-1,current+1))} style={{background:'none',border:`0.5px solid ${T.border}`,borderRadius:6,padding:'5px 12px',fontSize:12,cursor:'pointer',color:T.muted,fontFamily:FONT}}>→</button>
          }
        </div>
      </Card>
    </div>
  );
}

// ── Guided Reading Phase ────────────────────────────────────────────────────
function GuidedReadingPhase({sections}){
  const [openSection,setOpenSection]=useState(0);
  const [showAnswers,setShowAnswers]=useState({});

  if(!Array.isArray(sections)||sections.length===0) return <div style={{color:T.muted,textAlign:'center',padding:40}}>No hay secciones disponibles.</div>;

  return(
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      {sections.map((sec,i)=>{
        const isOpen=openSection===i;
        return(
          <Card key={i} style={{overflow:'hidden'}}>
            <div onClick={()=>setOpenSection(isOpen?-1:i)}
              style={{padding:'14px 18px',cursor:'pointer',display:'flex',alignItems:'center',gap:10,background:isOpen?T.tealS:T.surface}}>
              <span style={{width:28,height:28,borderRadius:8,background:isOpen?T.teal:T.border,color:isOpen?'#fff':T.muted,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,flexShrink:0}}>{i+1}</span>
              <span style={{fontSize:13,fontWeight:600,color:T.text,flex:1}}>{sec.title}</span>
              <span style={{color:T.dim,fontSize:16,transform:isOpen?'rotate(90deg)':'none',transition:'transform 0.2s'}}>›</span>
            </div>
            {isOpen&&(
              <div style={{padding:'16px 18px',borderTop:`1px solid ${T.border}`}}>
                <div style={{fontSize:12,color:T.text,lineHeight:1.8,marginBottom:14}}>{sec.summary}</div>
                {sec.keyPoints&&sec.keyPoints.length>0&&(
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:11,fontWeight:700,color:T.teal,marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Puntos clave</div>
                    <ul style={{margin:0,paddingLeft:18,display:'flex',flexDirection:'column',gap:4}}>
                      {sec.keyPoints.map((p,j)=><li key={j} style={{fontSize:12,color:T.text,lineHeight:1.6}}>{p}</li>)}
                    </ul>
                  </div>
                )}
                {sec.checkQuestion&&(
                  <div style={{background:T.amberS,border:`1px solid #d4b44a`,borderRadius:8,padding:'12px 14px'}}>
                    <div style={{fontSize:11,fontWeight:700,color:T.amberText,marginBottom:4}}>❓ Pregunta de comprensión</div>
                    <div style={{fontSize:12,color:T.text,lineHeight:1.6,marginBottom:6}}>{sec.checkQuestion.question}</div>
                    {showAnswers[i]
                      ?<div style={{fontSize:12,color:T.greenText,background:T.greenS,padding:'8px 10px',borderRadius:6,lineHeight:1.6}}>✅ {sec.checkQuestion.answer}</div>
                      :<button onClick={()=>setShowAnswers(prev=>({...prev,[i]:true}))} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,padding:'5px 12px',fontSize:11,cursor:'pointer',color:T.muted,fontFamily:FONT}}>Mostrar respuesta</button>
                    }
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ── Flashcards Phase ────────────────────────────────────────────────────────
function FlashcardsPhase({cards,onDominatedChange,onSm2Update}){
  const [current,setCurrent]=useState(0);
  const [flipped,setFlipped]=useState(false);
  const [ratings,setRatings]=useState({});
  const [fcSr,setFcSr]=useState({});
  const [showIntro,setShowIntro]=useState(true);

  if(!Array.isArray(cards)||cards.length===0) return <div style={{color:T.dim,textAlign:'center',padding:40}}>No hay flashcards disponibles.</div>;
  if(showIntro&&Object.keys(ratings).length===0) return(
    <Card style={{padding:'20px',textAlign:'center'}}>
      <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:8}}>🃏 Flashcards</div>
      <div style={{fontSize:12,color:T.dim,lineHeight:1.6,maxWidth:400,margin:'0 auto 16px'}}>Intenta recordar antes de voltear — el esfuerzo de recuperación, aunque falle, fortalece la memoria más que releer.</div>
      <button onClick={()=>setShowIntro(false)} style={{background:T.green,color:'#fff',border:'none',borderRadius:8,padding:'10px 24px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:FONT}}>Empezar →</button>
    </Card>
  );

  const card=cards[current];
  const rated=Object.keys(ratings).length;
  const dominated=Object.values(ratings).filter(q=>q>=3).length;

  const rateCard=(quality)=>{
    const newRatings={...ratings,[current]:quality};
    setRatings(newRatings);
    // Update SM-2 for this card
    const sr=sm2Update(fcSr[current],quality);
    const newSr={...fcSr,[current]:sr};
    setFcSr(newSr);
    // Report dominated count and SM-2 data
    const domCount=Object.values(newRatings).filter(q=>q>=3).length;
    onDominatedChange?.(domCount);
    onSm2Update?.({ratings:newRatings,sr:newSr});
    // Auto-advance
    if(current<cards.length-1){setTimeout(()=>{setCurrent(c=>c+1);setFlipped(false);},300);}
  };

  const isRated=ratings[current]!=null;
  const cardSr=fcSr[current];

  return(
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <span style={{fontSize:13,fontWeight:600,color:T.text}}>🃏 Flashcards — {current+1}/{cards.length}</span>
        <span style={{fontSize:12,color:T.green,fontWeight:600}}>{dominated} dominadas · {rated}/{cards.length} evaluadas</span>
      </div>
      <PBar pct={dominated/cards.length*100} color={T.green}/>
      <div onClick={()=>setFlipped(!flipped)}
        style={{background:flipped?T.tealS:T.surface,border:`0.5px solid ${flipped?T.teal:T.border}`,borderRadius:12,padding:'36px 28px',marginTop:14,cursor:'pointer',textAlign:'center',minHeight:140,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',transition:'all 0.2s'}}>
        <div style={{fontSize:10,color:T.dim,marginBottom:8,fontWeight:600,textTransform:'uppercase',letterSpacing:0.5}}>{flipped?'Respuesta':'Pregunta'} — clic para girar</div>
        <div style={{fontSize:15,color:flipped?T.tealText:T.text,fontWeight:600,lineHeight:1.6,maxWidth:500}}>{flipped?(card.back||'—'):(card.front||'—')}</div>
      </div>
      {/* SM-2 quality rating — visible after flipping */}
      {flipped&&!isRated&&(
        <div style={{display:'flex',justifyContent:'center',gap:6,marginTop:14}}>
          {[{q:0,l:'No sé',c:T.red},{q:1,l:'Mal',c:T.red},{q:2,l:'Difícil',c:T.amber},{q:3,l:'Regular',c:T.amber},{q:4,l:'Bien',c:T.green},{q:5,l:'Perfecto',c:T.green}].map(({q,l,c})=>(
            <button key={q} onClick={()=>rateCard(q)} style={{background:c+'18',border:`0.5px solid ${c}`,borderRadius:8,padding:'6px 10px',fontSize:11,cursor:'pointer',color:c,fontWeight:600,fontFamily:FONT}}>{q} {l}</button>
          ))}
        </div>
      )}
      {isRated&&(
        <div style={{textAlign:'center',marginTop:10,fontSize:11,color:T.dim}}>
          Evaluada: {ratings[current]}/5 {cardSr?`· Próximo repaso: ${cardSr.interval} día${cardSr.interval>1?'s':''} · EF: ${cardSr.ef.toFixed(1)}`:''}
        </div>
      )}
      <div style={{display:'flex',justifyContent:'center',gap:8,marginTop:12}}>
        <button onClick={()=>{setCurrent(Math.max(0,current-1));setFlipped(false);}} disabled={current===0}
          style={{background:'none',border:`0.5px solid ${T.border}`,borderRadius:8,padding:'6px 14px',fontSize:12,cursor:current===0?'not-allowed':'pointer',color:T.muted,fontFamily:FONT}}>←</button>
        <button onClick={()=>{setCurrent(Math.min(cards.length-1,current+1));setFlipped(false);}}  disabled={current===cards.length-1}
          style={{background:'none',border:`0.5px solid ${T.border}`,borderRadius:8,padding:'6px 14px',fontSize:12,cursor:current===cards.length-1?'not-allowed':'pointer',color:T.muted,fontFamily:FONT}}>→</button>
      </div>
    </div>
  );
}

// ── Clinical Cases Phase ────────────────────────────────────────────────────
function ClinicalCasesPhase({cases,onScoreChange}){
  const [currentCase,setCurrentCase]=useState(0);
  const [selectedOpt,setSelectedOpt]=useState({});
  const [revealed,setRevealed]=useState({});
  const [showIntro,setShowIntro]=useState(true);

  if(showIntro&&!Object.keys(revealed).length&&Array.isArray(cases)&&cases.length>0) return(
    <Card style={{padding:'20px',textAlign:'center'}}>
      <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:8}}>🔬 Casos de laboratorio</div>
      <div style={{fontSize:12,color:T.dim,lineHeight:1.6,maxWidth:400,margin:'0 auto 16px'}}>Desarrolla tu razonamiento completo antes de ver la solución — aplicar el conocimiento a un caso nuevo es la prueba definitiva de que lo has aprendido.</div>
      <button onClick={()=>setShowIntro(false)} style={{background:T.orange,color:'#fff',border:'none',borderRadius:8,padding:'10px 24px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:FONT}}>Empezar →</button>
    </Card>
  );

  if(!Array.isArray(cases)||cases.length===0) return <div style={{color:T.muted,textAlign:'center',padding:40}}>No hay casos clínicos disponibles.</div>;

  const c=cases[currentCase];
  const isRevealed=revealed[currentCase];

  return(
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <span style={{fontSize:13,fontWeight:600,color:T.text}}>🏥 Caso Clínico {currentCase+1}/{cases.length}</span>
        <div style={{display:'flex',gap:4}}>
          {cases.map((_,i)=>(
            <button key={i} onClick={()=>setCurrentCase(i)}
              style={{width:28,height:28,borderRadius:'50%',background:currentCase===i?T.orange:T.card,border:`1px solid ${currentCase===i?T.orange:T.border}`,color:currentCase===i?'#fff':T.muted,fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:FONT}}>{i+1}</button>
          ))}
        </div>
      </div>

      <Card style={{padding:'20px',borderLeft:`3px solid ${T.orange}`}}>
        <div style={{fontSize:10,fontWeight:700,color:T.orange,marginBottom:8,textTransform:'uppercase',letterSpacing:0.5}}>Presentación clínica</div>
        <div style={{fontSize:13,color:T.text,lineHeight:1.8,marginBottom:16}}>{c.presentation}</div>
        <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:10}}>{c.question}</div>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {(c.options||[]).map((opt,j)=>{
            const isSelected=selectedOpt[currentCase]===j;
            const isCorrect=j===c.correct;
            let bg=T.card,border=T.border,col=T.text;
            if(isRevealed&&isCorrect){bg=T.greenS;border=T.green;col=T.greenText;}
            else if(isRevealed&&isSelected&&!isCorrect){bg=T.redS;border=T.red;col=T.redText;}
            else if(isSelected){bg=T.orangeS;border=T.orange;col=T.orangeText;}
            return(
              <button key={j} onClick={()=>{if(!isRevealed){
                const newSel={...selectedOpt,[currentCase]:j};const newRev={...revealed,[currentCase]:true};
                setSelectedOpt(newSel);setRevealed(newRev);
                // Calculate clinical score when all cases answered
                if(onScoreChange){const total=cases.length;const answered=Object.keys(newRev).length;if(answered>=total){const correct=Object.entries(newSel).filter(([ci,a])=>a===cases[parseInt(ci)]?.correct).length;onScoreChange(Math.round(correct/total*100));}}
              }}}
                disabled={isRevealed} style={{background:bg,border:`1px solid ${border}`,borderRadius:8,padding:'10px 14px',fontSize:12,textAlign:'left',cursor:isRevealed?'default':'pointer',color:col,fontFamily:FONT}}>
                {opt}
              </button>
            );
          })}
        </div>
        {isRevealed&&c.discussion&&(
          <div style={{marginTop:14,padding:'12px 14px',background:T.blueS,borderRadius:8,fontSize:12,color:T.blueText,lineHeight:1.7,borderLeft:`3px solid ${T.blue}`}}>
            💡 <strong>Discusión:</strong> {c.discussion}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Fill-in-the-Blanks Phase ────────────────────────────────────────────────
function FillBlanksPhase({items,progress,onSaveProgress}){
  const [current,setCurrent]=useState(0);
  const [answers,setAnswers]=useState(progress?.answers||{});
  const [checking,setChecking]=useState({});
  const [results,setResults]=useState(progress?.results||{});

  if(!Array.isArray(items)||items.length===0) return <div style={{color:T.dim,textAlign:'center',padding:40}}>Sin preguntas de completar. Regenera la sección para incluirlas.</div>;

  const item=items[current];if(!item)return null;
  const answered=Object.keys(results).length;

  // Normalize: lowercase, remove accents/hyphens/symbols, collapse whitespace
  const norm=(s)=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[-–—·.,:;()\/]/g,' ').replace(/\s+/g,' ').trim();

  const checkAnswer=async()=>{
    const userAnswer=(answers[current]||'').trim();
    if(!userAnswer)return;
    setChecking(prev=>({...prev,[current]:true}));
    const expected=(item.answers||[item.answer]||['']).filter(Boolean);
    const userN=norm(userAnswer);

    // Step 1: Local quick check (covers exact, substring, normalized matches)
    let isCorrect=expected.some(exp=>{
      const expN=norm(exp);
      // Exact normalized match
      if(userN===expN)return true;
      // Substring containment (either direction)
      if(userN.includes(expN)||expN.includes(userN))return true;
      // Numeric range: if expected is "250-350" and user writes "300"
      const rangeMatch=exp.match(/(\d+)\s*[-–]\s*(\d+)/);
      if(rangeMatch){const lo=parseFloat(rangeMatch[1]),hi=parseFloat(rangeMatch[2]),uv=parseFloat(userAnswer);if(!isNaN(uv)&&uv>=lo&&uv<=hi)return true;}
      // User's number close to expected number (±15%)
      const expNum=parseFloat(exp.replace(/[^0-9.,]/g,'').replace(',','.'));
      const userNum=parseFloat(userAnswer.replace(/[^0-9.,]/g,'').replace(',','.'));
      if(!isNaN(expNum)&&!isNaN(userNum)&&expNum>0&&Math.abs(userNum-expNum)/expNum<0.15)return true;
      return false;
    });

    // Step 2: If local check fails, ask AI for semantic equivalence
    if(!isCorrect){
      try{
        const res=await fetch('/api/anthropic',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:256,messages:[{role:'user',content:
            `¿Son equivalentes estas respuestas? Responde SOLO "sí" o "no".\n\nPregunta: ${item.sentence}\nRespuesta del estudiante: "${userAnswer}"\nRespuestas aceptadas: ${expected.join(', ')}\n\nAcepta sinónimos, variaciones ortográficas (mayúsculas, guiones, símbolos griegos vs texto), abreviaturas y números dentro de rangos razonables.`
          }]})});
        if(res.ok){
          const d=await res.json();
          const txt=(d.content||[]).map(c=>c.text||'').join('').trim().toLowerCase();
          if(txt.startsWith('sí')||txt.startsWith('si')||txt==='yes')isCorrect=true;
        }
      }catch{}
    }

    setResults(prev=>{
      const n={...prev,[current]:{correct:isCorrect,userAnswer,expected,aiChecked:true}};
      const totalAnswered=Object.keys(n).length;
      const totalCorrect=Object.values(n).filter(r=>r.correct).length;
      onSaveProgress?.({answers,results:n,score:Math.round(totalCorrect/totalAnswered*100),completed:totalAnswered>=items.length});
      return n;
    });
    setChecking(prev=>({...prev,[current]:false}));
  };

  const result=results[current];

  return(
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <span style={{fontSize:13,fontWeight:600,color:T.text}}>✏️ Completar blancos — {current+1}/{items.length}</span>
        <span style={{fontSize:12,color:T.muted}}>{answered}/{items.length}</span>
      </div>
      <PBar pct={answered/items.length*100} color={T.purple}/>
      <Card style={{padding:'18px',marginTop:12}}>
        <div style={{fontSize:14,color:T.text,lineHeight:1.8,marginBottom:14}}>{item.sentence}</div>
        {!result?(
          <div style={{display:'flex',gap:8}}>
            <input value={answers[current]||''} onChange={e=>setAnswers(prev=>({...prev,[current]:e.target.value}))} placeholder="Escribe tu respuesta..."
              onKeyDown={e=>e.key==='Enter'&&checkAnswer()}
              style={{flex:1,background:T.bg,color:T.text,border:`0.5px solid ${T.border}`,borderRadius:8,padding:'8px 12px',fontSize:13,outline:'none',fontFamily:FONT}}/>
            <button onClick={checkAnswer} disabled={checking[current]||!answers[current]?.trim()}
              style={{background:checking[current]?T.bg:T.purple,color:checking[current]?T.muted:'#fff',border:'none',borderRadius:8,padding:'8px 16px',fontSize:12,fontWeight:700,cursor:checking[current]?'wait':'pointer',fontFamily:FONT}}>
              {checking[current]?'⏳ Evaluando...':'Comprobar'}
            </button>
          </div>
        ):(
          <div style={{padding:'10px 14px',borderRadius:8,background:result.correct?T.greenS:T.redS,border:`0.5px solid ${result.correct?T.green:T.red}`}}>
            <div style={{fontSize:12,color:result.correct?T.green:T.red,fontWeight:700,marginBottom:4}}>{result.correct?'✅ Correcto':'❌ Incorrecto'}</div>
            <div style={{fontSize:12,color:T.text}}>Tu respuesta: {result.userAnswer}</div>
            {!result.correct&&<div style={{fontSize:12,color:T.green,marginTop:2}}>Respuesta esperada: {(result.expected||[]).join(' / ')}</div>}
          </div>
        )}
        <div style={{display:'flex',justifyContent:'space-between',marginTop:12}}>
          <button onClick={()=>setCurrent(Math.max(0,current-1))} disabled={current===0} style={{background:'none',border:`0.5px solid ${T.border}`,borderRadius:6,padding:'5px 12px',fontSize:12,cursor:current===0?'not-allowed':'pointer',color:T.muted,fontFamily:FONT}}>←</button>
          <button onClick={()=>setCurrent(Math.min(items.length-1,current+1))} disabled={current===items.length-1} style={{background:'none',border:`0.5px solid ${T.border}`,borderRadius:6,padding:'5px 12px',fontSize:12,cursor:current===items.length-1?'not-allowed':'pointer',color:T.muted,fontFamily:FONT}}>→</button>
        </div>
      </Card>
    </div>
  );
}

// ── Differential Diagnosis Phase ────────────────────────────────────────────
function DiffDiagnosisPhase({pairs}){
  const [current,setCurrent]=useState(0);
  const [selA,setSelA]=useState({}); // {pairIdx: optionIdx}
  const [selB,setSelB]=useState({});
  const [checked,setChecked]=useState({});

  if(!Array.isArray(pairs)||pairs.length===0) return <div style={{color:T.dim,textAlign:'center',padding:40}}>Sin pares de diagnóstico diferencial. Regenera la sección para incluirlos.</div>;

  const pair=pairs[current];if(!pair)return null;
  const isChecked=checked[current];
  const bothSelected=selA[current]!=null&&selB[current]!=null;
  // Support both old format (no options) and new format (with optionsA/optionsB)
  const hasOptions=pair.optionsA?.length>0;

  return(
    <div>
      <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:12}}>⚖️ Diagnóstico diferencial — Par {current+1}/{pairs.length}</div>

      {/* Two columns: cases + options */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
        {/* Case A */}
        <div>
          <Card style={{padding:'16px',borderLeft:`3px solid ${T.blue}`,marginBottom:10}}>
            <div style={{fontSize:12,fontWeight:700,color:T.blue,marginBottom:6}}>Caso A</div>
            <div style={{fontSize:13,color:T.text,lineHeight:1.8}}>{pair.caseA}</div>
          </Card>
          {hasOptions&&(
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {pair.optionsA.map((opt,j)=>{
                const isSel=selA[current]===j;
                const isOk=j===pair.correctA;
                let bg=T.surface,bdr=T.border,col=T.text;
                if(isChecked&&isOk){bg=T.greenS;bdr=T.green;col=T.greenText;}
                else if(isChecked&&isSel&&!isOk){bg=T.redS;bdr=T.red;col=T.redText;}
                else if(isSel){bg=T.blueS;bdr=T.blue;col=T.blueText;}
                return <button key={j} onClick={()=>{if(!isChecked)setSelA(p=>({...p,[current]:j}));}} disabled={isChecked}
                  style={{background:bg,border:`1px solid ${bdr}`,borderRadius:8,padding:'10px 12px',fontSize:12,textAlign:'left',cursor:isChecked?'default':'pointer',color:col,fontFamily:FONT,transition:'all 200ms ease-in-out'}}>{opt}</button>;
              })}
            </div>
          )}
        </div>

        {/* Case B */}
        <div>
          <Card style={{padding:'16px',borderLeft:`3px solid ${T.orange}`,marginBottom:10}}>
            <div style={{fontSize:12,fontWeight:700,color:T.orange,marginBottom:6}}>Caso B</div>
            <div style={{fontSize:13,color:T.text,lineHeight:1.8}}>{pair.caseB}</div>
          </Card>
          {hasOptions&&(
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {pair.optionsB.map((opt,j)=>{
                const isSel=selB[current]===j;
                const isOk=j===pair.correctB;
                let bg=T.surface,bdr=T.border,col=T.text;
                if(isChecked&&isOk){bg=T.greenS;bdr=T.green;col=T.greenText;}
                else if(isChecked&&isSel&&!isOk){bg=T.redS;bdr=T.red;col=T.redText;}
                else if(isSel){bg=T.blueS;bdr=T.blue;col=T.blueText;}
                return <button key={j} onClick={()=>{if(!isChecked)setSelB(p=>({...p,[current]:j}));}} disabled={isChecked}
                  style={{background:bg,border:`1px solid ${bdr}`,borderRadius:8,padding:'10px 12px',fontSize:12,textAlign:'left',cursor:isChecked?'default':'pointer',color:col,fontFamily:FONT,transition:'all 200ms ease-in-out'}}>{opt}</button>;
              })}
            </div>
          )}
        </div>
      </div>

      {/* Check button */}
      {hasOptions&&!isChecked&&(
        <div style={{textAlign:'center',marginBottom:14}}>
          <button onClick={()=>setChecked(p=>({...p,[current]:true}))} disabled={!bothSelected}
            style={{background:bothSelected?T.teal:T.bg,color:bothSelected?'#fff':T.dim,border:`1px solid ${bothSelected?T.teal:T.border}`,borderRadius:10,padding:'10px 28px',fontSize:13,fontWeight:700,cursor:bothSelected?'pointer':'not-allowed',fontFamily:FONT,transition:'all 250ms ease-in-out'}}>
            Comprobar diagnósticos
          </button>
        </div>
      )}

      {/* Explanation — shown after checking or for old format */}
      {(isChecked||!hasOptions)&&pair.explanation&&(
        <Card style={{padding:'16px',borderLeft:`3px solid ${T.green}`,marginBottom:14,animation:'fadeIn 250ms ease-in-out'}}>
          <div style={{fontSize:12,fontWeight:700,color:T.green,marginBottom:6}}>Diagnóstico diferencial</div>
          <div style={{fontSize:13,color:T.text,lineHeight:1.8}}>{pair.explanation}</div>
        </Card>
      )}

      {/* Fallback for old format without options */}
      {!hasOptions&&!checked[current]&&(
        <div style={{textAlign:'center',marginBottom:14}}>
          <button onClick={()=>setChecked(p=>({...p,[current]:true}))} style={{background:T.amberS,border:`1px solid ${T.amber}`,borderRadius:8,padding:'8px 20px',fontSize:12,cursor:'pointer',color:T.amberText,fontWeight:600,fontFamily:FONT}}>Mostrar diagnóstico</button>
        </div>
      )}

      {/* Pair navigation */}
      {pairs.length>1&&(
        <div style={{display:'flex',justifyContent:'center',gap:8}}>
          {pairs.map((_,i)=>(
            <button key={i} onClick={()=>setCurrent(i)} style={{width:32,height:32,borderRadius:'50%',background:current===i?T.teal:T.surface,border:`1px solid ${current===i?T.teal:T.border}`,color:current===i?'#fff':T.dim,fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:FONT,transition:'all 200ms ease-in-out'}}>{i+1}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Open Questions Phase (AI-evaluated free response) ───────────────────────
function OpenQuestionsPhase({questions,progress,onSaveProgress}){
  const [current,setCurrent]=useState(0);
  const [answers,setAnswers]=useState(progress?.answers||{});
  const [evals,setEvals]=useState(progress?.evals||{});
  const [evaluating,setEvaluating]=useState(false);

  if(!Array.isArray(questions)||!questions.length) return <div style={{color:T.dim,textAlign:'center',padding:40}}>Sin preguntas abiertas. Regenera la sección.</div>;

  const q=questions[current];if(!q)return null;
  const ev=evals[current];
  const answered=Object.keys(evals).length;

  const evaluate=async()=>{
    const userAnswer=(answers[current]||'').trim();
    if(!userAnswer)return;
    setEvaluating(true);
    try{
      const res=await fetch('/api/anthropic',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:1024,messages:[{role:'user',content:`Eres un evaluador experto en bioquímica clínica (FEA Laboratorio Clínico). Evalúa esta respuesta. Responde SOLO con JSON válido.\n\nPREGUNTA: ${q.question}\nRESPUESTA: ${userAnswer}\n\nEscala 0-4: 0=incorrecta, 1=parcial, 2=correcta con lagunas, 3=correcta, 4=completa.\n\nJSON: {"score":0,"feedback":"evaluación específica","missing":["concepto que faltó"]}`}]})
      });
      if(!res.ok)throw new Error('Error evaluando');
      const data=await res.json();
      const text=(data.content||[]).map(c=>c.text||'').join('').trim().replace(/```json|```/g,'').trim();
      const result=JSON.parse(text);
      const newEvals={...evals,[current]:result};
      setEvals(newEvals);
      const totalScore=Object.values(newEvals).reduce((a,e)=>a+e.score,0);
      const maxScore=Object.keys(newEvals).length*4;
      onSaveProgress?.({answers,evals:newEvals,score:Math.round(totalScore/maxScore*100),completed:Object.keys(newEvals).length>=questions.length});
    }catch(e){setEvals(prev=>({...prev,[current]:{score:0,feedback:`Error: ${e.message}`,missing:[]}}));}
    setEvaluating(false);
  };

  const scoreColors=['#ef4444','#f97316','#fbbf24','#4ade80','#22c55e'];

  return(
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <span style={{fontSize:13,fontWeight:600,color:T.text}}>💬 Pregunta abierta — {current+1}/{questions.length}</span>
        <span style={{fontSize:12,color:T.muted}}>{answered}/{questions.length} evaluadas</span>
      </div>
      <Card style={{padding:'18px'}}>
        <div style={{fontSize:14,color:T.text,lineHeight:1.8,marginBottom:14,fontWeight:500}}>{q.question}</div>
        {!ev?(
          <div>
            <textarea value={answers[current]||''} onChange={e=>setAnswers(prev=>({...prev,[current]:e.target.value}))} placeholder="Escribe tu respuesta completa..."
              style={{width:'100%',minHeight:120,background:T.bg,color:T.text,border:`0.5px solid ${T.border}`,borderRadius:8,padding:'10px 12px',fontSize:13,fontFamily:FONT,resize:'vertical',outline:'none',boxSizing:'border-box',lineHeight:1.7,marginBottom:10}}/>
            <button onClick={evaluate} disabled={evaluating||!answers[current]?.trim()}
              style={{background:evaluating?T.surface:T.teal,color:evaluating?T.dim:'#000',border:`0.5px solid ${evaluating?T.border:T.teal}`,borderRadius:8,padding:'8px 20px',fontSize:12,fontWeight:700,cursor:evaluating?'wait':'pointer',fontFamily:FONT}}>
              {evaluating?'⏳ Evaluando con IA...':'Evaluar respuesta'}
            </button>
          </div>
        ):(
          <div>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
              <span style={{fontSize:24,fontWeight:700,color:scoreColors[ev.score]||T.dim}}>{ev.score}/4</span>
              <span style={{fontSize:12,color:T.muted}}>{['Incorrecta','Parcial','Con lagunas','Correcta','Completa'][ev.score]||'—'}</span>
            </div>
            <div style={{fontSize:12,color:T.text,lineHeight:1.7,background:T.bg,padding:'10px 14px',borderRadius:8,border:`0.5px solid ${T.border}`,marginBottom:8}}>{ev.feedback}</div>
            {ev.missing?.length>0&&(
              <div style={{fontSize:11,color:T.amber}}>Conceptos que faltaron: {ev.missing.join(', ')}</div>
            )}
            {q.modelAnswer&&<div style={{marginTop:8,fontSize:11,color:T.dim,borderLeft:`2px solid ${T.green}`,paddingLeft:10}}>Respuesta modelo: {q.modelAnswer}</div>}
          </div>
        )}
        <div style={{display:'flex',justifyContent:'space-between',marginTop:12}}>
          <button onClick={()=>setCurrent(Math.max(0,current-1))} disabled={current===0} style={{background:'none',border:`0.5px solid ${T.border}`,borderRadius:6,padding:'5px 12px',fontSize:12,cursor:current===0?'not-allowed':'pointer',color:T.muted,fontFamily:FONT}}>←</button>
          <button onClick={()=>setCurrent(Math.min(questions.length-1,current+1))} disabled={current===questions.length-1} style={{background:'none',border:`0.5px solid ${T.border}`,borderRadius:6,padding:'5px 12px',fontSize:12,cursor:current===questions.length-1?'not-allowed':'pointer',color:T.muted,fontFamily:FONT}}>→</button>
        </div>
      </Card>
    </div>
  );
}

// ConceptMapPhase REMOVED
if(false){
function ConceptMapPhase({concepts,relations}){
  const [showModel,setShowModel]=useState(false);
  const [userConnections,setUserConnections]=useState([]);
  const [selectedA,setSelectedA]=useState(null);

  const conceptNames=(concepts||[]).slice(0,15).map(c=>c.t||c.nombre||'');

  const addConnection=(a,b)=>{
    if(a===b)return;
    if(userConnections.some(c=>(c.from===a&&c.to===b)||(c.from===b&&c.to===a)))return;
    setUserConnections(prev=>[...prev,{from:a,to:b}]);
  };

  return(
    <div>
      <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:6}}>🗺️ Mapa de relaciones</div>
      <div style={{fontSize:11,color:T.dim,marginBottom:14,lineHeight:1.5}}>Selecciona dos conceptos para conectarlos. Construye tu mapa de memoria. Después compara con el modelo.</div>

      {/* Concept buttons */}
      <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:16}}>
        {conceptNames.filter(Boolean).map((c,i)=>(
          <button key={i} onClick={()=>{
            if(selectedA===null)setSelectedA(c);
            else{addConnection(selectedA,c);setSelectedA(null);}
          }} style={{padding:'5px 12px',fontSize:11,borderRadius:8,cursor:'pointer',fontFamily:FONT,fontWeight:600,
            background:selectedA===c?T.green+'30':T.surface,
            border:`0.5px solid ${selectedA===c?T.green:T.border}`,
            color:selectedA===c?T.green:T.text}}>
            {c}
          </button>
        ))}
      </div>
      {selectedA&&<div style={{fontSize:11,color:T.green,marginBottom:8}}>Seleccionado: "{selectedA}" — elige el segundo concepto para conectar</div>}

      {/* User connections */}
      {userConnections.length>0&&(
        <Card style={{padding:'12px 16px',marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:700,color:T.text,marginBottom:6}}>Tus conexiones ({userConnections.length})</div>
          <div style={{display:'flex',flexDirection:'column',gap:3}}>
            {userConnections.map((c,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:6,fontSize:11}}>
                <span style={{color:T.teal,fontWeight:600}}>{c.from}</span>
                <span style={{color:T.dim}}>↔</span>
                <span style={{color:T.teal,fontWeight:600}}>{c.to}</span>
                <button onClick={()=>setUserConnections(prev=>prev.filter((_,j)=>j!==i))} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:10,padding:'0 4px'}}>×</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Show/hide model */}
      <button onClick={()=>setShowModel(!showModel)}
        style={{background:showModel?T.greenS:T.surface,border:`0.5px solid ${showModel?T.green:T.border}`,borderRadius:8,padding:'8px 18px',fontSize:12,cursor:'pointer',color:showModel?T.green:T.muted,fontWeight:600,fontFamily:FONT,marginBottom:12}}>
        {showModel?'Ocultar mapa modelo':'Mostrar mapa modelo para comparar'}
      </button>

      {showModel&&(relations||[]).length>0&&(
        <Card style={{padding:'14px 16px',borderLeft:`2px solid ${T.green}`}}>
          <div style={{fontSize:11,fontWeight:700,color:T.green,marginBottom:8}}>Mapa modelo ({relations.length} relaciones)</div>
          <div style={{display:'flex',flexDirection:'column',gap:4}}>
            {relations.map((r,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:6,fontSize:11}}>
                <span style={{color:T.text,fontWeight:600}}>{r.from}</span>
                <span style={{color:T.amber,fontSize:10,fontStyle:'italic'}}>—{r.relation}→</span>
                <span style={{color:T.text,fontWeight:600}}>{r.to}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}} /* end ConceptMapPhase dead code */

// ── Interactive Questions Phase (sequences, classification, matching, etc.) ─
function InteractiveQuestionsPhase({data:rawData}){
  // Guard: ensure data is a valid object
  const data=(rawData&&typeof rawData==='object'&&!Array.isArray(rawData))?rawData:{};
  const [revealed,setRevealed]=useState({});
  const [userOrder,setUserOrder]=useState({});
  const [dragFrom,setDragFrom]=useState(null);
  const [dragNode,setDragNode]=useState(null); // drop target index for visual feedback
  const [clAssignments,setClAssignments]=useState({});
  const [matchSelLeft,setMatchSelLeft]=useState({});
  const [matchPairs,setMatchPairs]=useState({});
  const [errorSel,setErrorSel]=useState({});
  const [patternSel,setPatternSel]=useState({});

  const tabs=[
    {id:'sequences',label:'Ordenar',count:Array.isArray(data.sequences)?data.sequences.length:0},
    {id:'classifications',label:'Clasificar',count:Array.isArray(data.classifications)?data.classifications.length:0},
    {id:'matching',label:'Emparejar',count:Array.isArray(data.matching)?data.matching.length:0},
    {id:'errors',label:'Error',count:Array.isArray(data.errors)?data.errors.length:0},
    {id:'progressiveCases',label:'Progresivo',count:Array.isArray(data.progressiveCases)?data.progressiveCases.length:0},
    {id:'patterns',label:'Patrones',count:Array.isArray(data.patterns)?data.patterns.length:0},
  ].filter(t=>t.count>0);

  // Default tab to first available (not hardcoded 'sequences')
  const [tab,setTab]=useState(tabs[0]?.id||'sequences');

  if(!tabs.length) return <div style={{color:T.dim,textAlign:'center',padding:40}}>Sin preguntas interactivas. Regenera la sección.</div>;

  const activeItems=Array.isArray(data[tab])?data[tab]:[];

  return(
    <div>
      <div style={{display:'flex',gap:3,marginBottom:12,flexWrap:'wrap'}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:'3px 8px',fontSize:9,fontWeight:tab===t.id?700:500,color:tab===t.id?T.orange:T.muted,background:tab===t.id?T.orangeS:T.surface,border:`0.5px solid ${tab===t.id?T.orange:T.border}`,borderRadius:5,cursor:'pointer',fontFamily:FONT}}>
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {/* Sequences — drag to reorder with visual feedback */}
      {tab==='sequences'&&activeItems.map((seq,si)=>{
        const order=userOrder[si]||seq.steps.map((_,i)=>i);
        const isRev=revealed[`seq-${si}`];
        const isCorrect=isRev&&JSON.stringify(order)===JSON.stringify(seq.correctOrder);
        return(
          <Card key={si} style={{padding:'16px',marginBottom:10}}>
            <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:10}}>{seq.instruction}</div>
            <div style={{display:'flex',flexDirection:'column',gap:5}}>
              {order.map((stepIdx,pos)=>{
                const isDragging=dragFrom===pos;
                const isOver=dragNode===pos&&dragFrom!==pos;
                return(
                  <div key={pos} draggable
                    onDragStart={e=>{setDragFrom(pos);e.dataTransfer.effectAllowed='move';}}
                    onDragEnd={()=>{setDragFrom(null);setDragNode(null);}}
                    onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='move';setDragNode(pos);}}
                    onDragLeave={()=>setDragNode(null)}
                    onDrop={e=>{e.preventDefault();if(dragFrom!==null&&dragFrom!==pos){const n=[...order];const[m]=n.splice(dragFrom,1);n.splice(pos,0,m);setUserOrder(p=>({...p,[si]:n}));}setDragFrom(null);setDragNode(null);}}
                    onTouchStart={e=>{setDragFrom(pos);}}
                    onTouchEnd={e=>{setDragFrom(null);setDragNode(null);}}
                    style={{
                      display:'flex',alignItems:'center',gap:8,padding:'8px 12px',
                      background:isRev?(stepIdx===seq.correctOrder[pos]?T.greenS:T.redS):isOver?T.tealS:T.surface,
                      border:`1px solid ${isOver?T.teal:isDragging?T.blue:T.border}`,
                      borderRadius:8,fontSize:12,color:T.text,
                      cursor:isDragging?'grabbing':'grab',
                      opacity:isDragging?0.5:1,
                      transform:isDragging?'scale(1.02)':'none',
                      boxShadow:isDragging?sh.md:'none',
                      transition:'all 200ms ease-in-out',
                      userSelect:'none',
                    }}>
                    <span style={{color:T.dim,fontSize:10,fontWeight:700,minWidth:16}}>⠿ {pos+1}</span>
                    <span style={{flex:1}}>{seq.steps[stepIdx]}</span>
                  </div>
                );
              })}
            </div>
            {!isRev?<button onClick={()=>setRevealed(p=>({...p,[`seq-${si}`]:true}))} style={{marginTop:10,background:T.teal,color:'#fff',border:'none',borderRadius:8,padding:'8px 18px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:FONT,transition:'all 200ms ease-in-out'}}>Comprobar orden</button>
            :<div style={{marginTop:8,fontSize:12,color:isCorrect?T.green:T.red,fontWeight:600}}>{isCorrect?'✓ Orden correcto':'✗ Orden incorrecto — revisa los pasos'}</div>}
          </Card>
        );
      })}

      {/* Classifications — pool of items to drag into categories */}
      {tab==='classifications'&&activeItems.map((cl,ci)=>{
        const assignments=clAssignments[ci]||{};
        const isChecked=revealed[`cl-${ci}`];
        const allAssigned=Object.keys(assignments).length>=(cl.items||[]).length;
        const unassigned=(cl.items||[]).filter((_,idx)=>assignments[idx]==null);
        return(
          <Card key={ci} style={{padding:'16px',marginBottom:10}}>
            {/* Unassigned pool */}
            {!isChecked&&unassigned.length>0&&(
              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,color:T.muted,marginBottom:6}}>Arrastra cada item a su categoría:</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                  {(cl.items||[]).map((it,idx)=>{
                    if(assignments[idx]!=null)return null;
                    return <div key={idx} draggable onDragStart={()=>setDragFrom(idx)} onDragEnd={()=>setDragFrom(null)}
                      style={{padding:'6px 10px',fontSize:11,background:T.surface,border:`1px solid ${dragFrom===idx?T.teal:T.border}`,borderRadius:6,cursor:'grab',opacity:dragFrom===idx?0.5:1,transition:'all 200ms ease-in-out',userSelect:'none'}}>{it.text}</div>;
                  })}
                </div>
              </div>
            )}
            {/* Category columns */}
            <div style={{display:'flex',gap:10,marginBottom:10}}>
              {(cl.categories||[]).map((cat,catIdx)=>{
                const catItems=(cl.items||[]).map((it,idx)=>({...it,idx})).filter(it=>assignments[it.idx]===catIdx);
                const isDropTarget=dragFrom!=null&&dragNode===`cl-${ci}-${catIdx}`;
                return(
                  <div key={catIdx}
                    onDragOver={e=>{e.preventDefault();setDragNode(`cl-${ci}-${catIdx}`);}}
                    onDragLeave={()=>setDragNode(null)}
                    onDrop={e=>{e.preventDefault();if(dragFrom!=null)setClAssignments(p=>({...p,[ci]:{...(p[ci]||{}),[dragFrom]:catIdx}}));setDragFrom(null);setDragNode(null);}}
                    style={{flex:1,background:isDropTarget?T.tealS:T.bg,border:`1px solid ${isDropTarget?T.teal:T.border}`,borderRadius:8,padding:'10px',minHeight:70,transition:'all 200ms ease-in-out'}}>
                    <div style={{fontSize:11,fontWeight:700,color:T.text,marginBottom:6}}>{cat}</div>
                    {catItems.map(it=>(
                      <div key={it.idx} style={{fontSize:11,color:isChecked?(it.category===catIdx?T.green:T.red):T.text,padding:'3px 0',fontWeight:isChecked?600:400}}>{isChecked?(it.category===catIdx?'✓ ':'✗ '):''}{it.text}</div>
                    ))}
                  </div>
                );
              })}
            </div>
            {!isChecked?<button onClick={()=>setRevealed(p=>({...p,[`cl-${ci}`]:true}))} disabled={!allAssigned}
              style={{background:allAssigned?T.teal:T.bg,color:allAssigned?'#fff':T.dim,border:'none',borderRadius:8,padding:'8px 18px',fontSize:12,fontWeight:700,cursor:allAssigned?'pointer':'not-allowed',fontFamily:FONT}}>Comprobar clasificación</button>
            :<div style={{fontSize:12,fontWeight:600,color:T.green}}>✓ Clasificación comprobada</div>}
          </Card>
        );
      })}

      {/* Matching — click to select and pair */}
      {tab==='matching'&&activeItems.map((m,mi)=>{
        const pairs=matchPairs[mi]||[];
        const selLeft=matchSelLeft[mi];
        const isChecked=revealed[`m-${mi}`];
        const allPaired=pairs.length>=(m.left||[]).length;
        const pairedLefts=new Set(pairs.map(p=>p[0]));
        const pairedRights=new Set(pairs.map(p=>p[1]));
        return(
          <Card key={mi} style={{padding:'16px',marginBottom:10}}>
            <div style={{fontSize:11,color:T.muted,marginBottom:8}}>Clic en un término de la izquierda, luego clic en su definición a la derecha.</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:10}}>
              <div style={{display:'flex',flexDirection:'column',gap:4}}>
                {(m.left||[]).map((l,i)=>{
                  const isPaired=pairedLefts.has(i);
                  const isSel=selLeft===i;
                  return <button key={i} onClick={()=>{if(!isChecked&&!isPaired)setMatchSelLeft(p=>({...p,[mi]:isSel?null:i}));}} disabled={isChecked||isPaired}
                    style={{padding:'8px 10px',fontSize:12,textAlign:'left',borderRadius:6,cursor:isPaired||isChecked?'default':'pointer',
                      background:isSel?T.blueS:isPaired?T.greenS:T.surface,
                      border:`1px solid ${isSel?T.blue:isPaired?T.green:T.border}`,
                      color:isPaired?T.green:T.text,fontFamily:FONT,transition:'all 200ms ease-in-out'}}>{l}</button>;
                })}
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:4}}>
                {(m.right||[]).map((r,i)=>{
                  const isPaired=pairedRights.has(i);
                  return <button key={i} onClick={()=>{if(!isChecked&&!isPaired&&selLeft!=null){
                    setMatchPairs(p=>({...p,[mi]:[...(p[mi]||[]),[selLeft,i]]}));setMatchSelLeft(p=>({...p,[mi]:null}));
                  }}} disabled={isChecked||isPaired||selLeft==null}
                    style={{padding:'8px 10px',fontSize:12,textAlign:'left',borderRadius:6,cursor:isPaired||isChecked||selLeft==null?'default':'pointer',
                      background:isPaired?T.tealS:selLeft!=null?T.surface:T.bg,
                      border:`1px solid ${isPaired?T.teal:selLeft!=null?T.border2:T.border}`,
                      color:isPaired?T.teal:T.text,fontFamily:FONT,transition:'all 200ms ease-in-out'}}>{r}</button>;
                })}
              </div>
            </div>
            {/* Show paired connections */}
            {pairs.length>0&&!isChecked&&<div style={{fontSize:10,color:T.dim,marginBottom:6}}>{pairs.map(([l,r],i)=><span key={i} style={{marginRight:8}}>{m.left[l]} ↔ {m.right[r]}</span>)}</div>}
            {!isChecked?<button onClick={()=>setRevealed(p=>({...p,[`m-${mi}`]:true}))} disabled={!allPaired}
              style={{background:allPaired?T.teal:T.bg,color:allPaired?'#fff':T.dim,border:'none',borderRadius:8,padding:'8px 18px',fontSize:12,fontWeight:700,cursor:allPaired?'pointer':'not-allowed',fontFamily:FONT}}>Comprobar parejas</button>
            :<div style={{marginTop:4}}>{pairs.map(([l,r],i)=>{const correct=(m.pairs||[]).some(([cl,cr])=>cl===l&&cr===r);return <div key={i} style={{fontSize:11,color:correct?T.green:T.red,fontWeight:600}}>{correct?'✓':'✗'} {m.left[l]} ↔ {m.right[r]}</div>;})}</div>}
          </Card>
        );
      })}

      {/* Errors — select the incorrect part, then check */}
      {tab==='errors'&&activeItems.map((e,ei)=>{
        const sel=errorSel[ei];
        const isChecked=revealed[`e-${ei}`];
        return(
          <Card key={ei} style={{padding:'16px',marginBottom:10}}>
            <div style={{fontSize:13,color:T.text,lineHeight:1.8,marginBottom:10,padding:'10px 14px',background:T.bg,borderRadius:8,border:`1px solid ${T.border}`,fontStyle:'italic'}}>"{e.statement}"</div>
            <div style={{fontSize:11,color:T.muted,marginBottom:6}}>¿Qué parte es incorrecta?</div>
            <div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:10}}>
              {(e.options||[]).map((o,j)=>{
                const isSel=sel===j;
                const isError=o===e.errorPart;
                let bg=T.surface,bdr=T.border,col=T.text;
                if(isChecked&&isError){bg=T.redS;bdr=T.red;col=T.redText;}
                else if(isChecked&&isSel&&!isError){bg=T.amberS;bdr=T.amber;col=T.amberText;}
                else if(isSel){bg=T.blueS;bdr=T.blue;col=T.blueText;}
                return <button key={j} onClick={()=>{if(!isChecked)setErrorSel(p=>({...p,[ei]:j}));}} disabled={isChecked}
                  style={{padding:'6px 12px',fontSize:12,borderRadius:8,cursor:isChecked?'default':'pointer',background:bg,border:`1px solid ${bdr}`,color:col,fontFamily:FONT,transition:'all 200ms ease-in-out'}}>{o}</button>;
              })}
            </div>
            {!isChecked?<button onClick={()=>setRevealed(p=>({...p,[`e-${ei}`]:true}))} disabled={sel==null}
              style={{background:sel!=null?T.teal:T.bg,color:sel!=null?'#fff':T.dim,border:'none',borderRadius:8,padding:'8px 18px',fontSize:12,fontWeight:700,cursor:sel!=null?'pointer':'not-allowed',fontFamily:FONT}}>Comprobar</button>
            :(
              <div style={{padding:'10px 14px',background:T.bg,borderRadius:8,border:`1px solid ${T.border}`}}>
                <div style={{fontSize:12,color:T.red,fontWeight:600,marginBottom:4}}>Error: {e.errorPart}</div>
                <div style={{fontSize:12,color:T.green}}>Corrección: {e.correction}</div>
              </div>
            )}
          </Card>
        );
      })}

      {/* Progressive cases — reveal step by step */}
      {tab==='progressiveCases'&&activeItems.map((pc,pi)=>{
        const step=revealed[`pc-${pi}`]||0;
        const steps=[pc.step1,pc.step2,pc.step3].filter(Boolean);
        return(
          <Card key={pi} style={{padding:'16px',marginBottom:10}}>
            <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:10}}>Caso progresivo</div>
            {steps.slice(0,step+1).map((s,i)=>(
              <div key={i} style={{marginBottom:10,padding:'10px 14px',background:T.bg,borderRadius:8,border:`1px solid ${T.border}`,borderLeft:`3px solid ${[T.blue,T.amber,T.green][i]}`,animation:'fadeIn 250ms ease-in-out'}}>
                <div style={{fontSize:10,fontWeight:700,color:[T.blue,T.amber,T.green][i],marginBottom:3}}>Paso {i+1}</div>
                <div style={{fontSize:13,color:T.text,lineHeight:1.7}}>{s.info}</div>
                <div style={{fontSize:12,color:T.teal,marginTop:6,fontWeight:600,fontStyle:'italic'}}>{s.question}</div>
              </div>
            ))}
            {step<steps.length-1?<button onClick={()=>setRevealed(p=>({...p,[`pc-${pi}`]:(step||0)+1}))} style={{background:T.teal,color:'#fff',border:'none',borderRadius:8,padding:'8px 18px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:FONT,transition:'all 200ms ease-in-out'}}>Siguiente paso →</button>
            :step>=steps.length-1&&!revealed[`pc-${pi}-ans`]?<button onClick={()=>setRevealed(p=>({...p,[`pc-${pi}-ans`]:true}))} style={{background:T.green,color:'#fff',border:'none',borderRadius:8,padding:'8px 18px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:FONT}}>Ver diagnóstico</button>
            :<div style={{fontSize:13,color:T.green,lineHeight:1.7,marginTop:8,padding:'10px 14px',background:T.greenS,borderRadius:8,border:`1px solid ${T.green}`,animation:'fadeIn 250ms ease-in-out'}}>{pc.answer}</div>}
          </Card>
        );
      })}

      {/* Patterns — structured results table with selectable options */}
      {tab==='patterns'&&activeItems.map((pt,pi)=>{
        const sel=patternSel[pi];
        const isChecked=revealed[`pt-${pi}`];
        return(
          <Card key={pi} style={{padding:'16px',marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:700,color:T.muted,marginBottom:6}}>Resultados analíticos:</div>
            <div style={{marginBottom:12,padding:'10px 14px',background:T.bg,borderRadius:8,border:`1px solid ${T.border}`,fontFamily:'monospace',fontSize:12,color:T.text,lineHeight:1.8,whiteSpace:'pre-wrap'}}>{pt.results}</div>
            <div style={{fontSize:11,color:T.muted,marginBottom:6}}>¿Qué patrón patológico sugieren estos resultados?</div>
            <div style={{display:'flex',flexDirection:'column',gap:5,marginBottom:10}}>
              {(pt.options||[]).map((o,j)=>{
                const isSel=sel===j;
                const isCorrect=j===pt.correct;
                let bg=T.surface,bdr=T.border,col=T.text;
                if(isChecked&&isCorrect){bg=T.greenS;bdr=T.green;col=T.greenText;}
                else if(isChecked&&isSel&&!isCorrect){bg=T.redS;bdr=T.red;col=T.redText;}
                else if(isSel){bg=T.blueS;bdr=T.blue;col=T.blueText;}
                return <button key={j} onClick={()=>{if(!isChecked)setPatternSel(p=>({...p,[pi]:j}));}} disabled={isChecked}
                  style={{padding:'8px 12px',fontSize:12,textAlign:'left',borderRadius:8,cursor:isChecked?'default':'pointer',background:bg,border:`1px solid ${bdr}`,color:col,fontFamily:FONT,transition:'all 200ms ease-in-out'}}>{o}</button>;
              })}
            </div>
            {!isChecked?<button onClick={()=>setRevealed(p=>({...p,[`pt-${pi}`]:true}))} disabled={sel==null}
              style={{background:sel!=null?T.teal:T.bg,color:sel!=null?'#fff':T.dim,border:'none',borderRadius:8,padding:'8px 18px',fontSize:12,fontWeight:700,cursor:sel!=null?'pointer':'not-allowed',fontFamily:FONT}}>Comprobar</button>
            :(
              <div style={{padding:'10px 14px',background:T.bg,borderRadius:8,border:`1px solid ${T.border}`,animation:'fadeIn 250ms ease-in-out'}}>
                <div style={{fontSize:12,color:sel===pt.correct?T.green:T.red,fontWeight:700,marginBottom:4}}>{sel===pt.correct?'✓ Correcto':'✗ Incorrecto'}</div>
                <div style={{fontSize:12,color:T.green,fontWeight:600}}>Patrón: {pt.options[pt.correct]}</div>
                {pt.explanation&&<div style={{fontSize:12,color:T.muted,lineHeight:1.7,marginTop:4}}>{pt.explanation}</div>}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ── Spaced Repetition Phase ─────────────────────────────────────────────────
function SpacedRepetitionPhase({schedule,topic,learning,saveLearningData}){
  if(!schedule)return <div style={{color:T.muted,textAlign:'center',padding:40}}>No hay plan de repaso.</div>;
  const today=new Date().toISOString().slice(0,10);

  // Support both old format (object keyed by label) and new format (array)
  const reviews=Array.isArray(schedule.reviews)?schedule.reviews:
    Object.entries(schedule.reviews||{}).map(([label,rev])=>({label,fechaProgramada:rev.date,completado:rev.completed,type:label.replace('D+','d'),id:label}));
  const sorted=[...reviews].sort((a,b)=>(a.fechaProgramada||'').localeCompare(b.fechaProgramada||''));
  const completedCount=sorted.filter(r=>r.completado).length;
  const typeInfo=Object.fromEntries(REVIEW_TYPES.map(rt=>[rt.type,rt]));

  return(
    <div>
      <Card style={{padding:'20px',marginBottom:16}}>
        <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:6}}>📅 Plan de Repaso Espaciado</div>
        <div style={{fontSize:12,color:T.muted,marginBottom:8}}>{completedCount}/{sorted.length} completados</div>
        <PBar pct={sorted.length?completedCount/sorted.length*100:0} color={T.teal}/>
      </Card>
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {sorted.map((rev,i)=>{
          const isPast=(rev.fechaProgramada||rev.date||'')<=today;
          const isDue=isPast&&!rev.completado;
          const isCompleted=rev.completado;
          const info=typeInfo[rev.type]||{};
          const borderColor=isCompleted?T.green:isDue?T.red:T.border;
          return(
            <Card key={rev.id||i} style={{padding:'16px 18px',borderLeft:`3px solid ${borderColor}`,transition:'all 250ms ease-in-out'}}>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:28,height:28,borderRadius:'50%',background:isCompleted?T.green:T.surface,border:`2px solid ${borderColor}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,color:isCompleted?'#fff':T.dim,fontWeight:700,flexShrink:0}}>
                  {isCompleted?'✓':rev.label?.replace('D+','')||''}
                </div>
                <div style={{flex:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <span style={{fontSize:13,fontWeight:700,color:isCompleted?T.green:isDue?T.red:T.text}}>{rev.label||rev.type}</span>
                    {info.type&&<span style={{fontSize:10,color:T.muted,background:T.bg,padding:'1px 6px',borderRadius:4}}>{info.type}</span>}
                    {info.duration&&<span style={{fontSize:10,color:T.dim}}>~{info.duration} min</span>}
                  </div>
                  <div style={{fontSize:11,color:T.muted}}>{fmtDate(rev.fechaProgramada||rev.date)}{info.desc?` · ${info.desc}`:''}</div>
                  {rev.dominioPrevio!=null&&<div style={{fontSize:10,color:T.dim}}>Dominio previo: {rev.dominioPrevio}%</div>}
                </div>
                {isDue&&<span style={{fontSize:11,color:T.red,fontWeight:700,background:T.redS,padding:'4px 12px',borderRadius:20}}>⏰ Pendiente</span>}
                {isCompleted&&<span style={{fontSize:11,color:T.green,fontWeight:600}}>✅</span>}
                {!isPast&&!isCompleted&&<span style={{fontSize:10,color:T.dim}}>{Math.ceil((new Date(rev.fechaProgramada)-new Date())/86400000)} días</span>}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST MODE
// ═══════════════════════════════════════════════════════════════════════════
function TestMode({testQs,marked,errSet,toggleMark,recordAnswer,addSession}){
  const [phase,setPhase]=useState('setup');
  const [cfg,setCfg]=useState({section:'all',topic:'all',mode:'all',n:10,timer:0});
  const [session,setSession]=useState([]);
  const [idx,setIdx]=useState(0);
  const [answers,setAnswers]=useState([]);
  const [selected,setSelected]=useState(null);
  const [revealed,setRevealed]=useState(false);
  const [timeLeft,setTimeLeft]=useState(0);
  const [startTs,setStartTs]=useState(0);
  const timerRef=useRef(null);const revealRef=useRef(null);

  const handleReveal=useCallback((sel,sess,i)=>{
    clearInterval(timerRef.current);
    const q=sess[i];if(!q)return;
    recordAnswer(q.id,q.topic,sel===q.correct,sel===null?0:sel===q.correct?5:2,{seccion:q.seccion,subseccion:q.subseccion,tipo:q.tipo,fase:q.fase});
    setSelected(sel);setRevealed(true);
  },[recordAnswer]);

  useEffect(()=>{revealRef.current={handleReveal,session,idx};},[handleReveal,session,idx]);
  useEffect(()=>{
    if(phase!=='running'||cfg.timer===0||revealed)return;
    setTimeLeft(cfg.timer);
    timerRef.current=setInterval(()=>{setTimeLeft(t=>{if(t<=1){clearInterval(timerRef.current);const{handleReveal:hr,session:s,idx:i}=revealRef.current;hr(null,s,i);return 0;}return t-1;});},1000);
    return()=>clearInterval(timerRef.current);
  },[idx,phase,revealed]);

  const start=()=>{
    const sectionTopics=cfg.section==='all'?null:SECTIONS.find(s=>s.id===cfg.section)?.topics;
    let pool=testQs;
    if(sectionTopics)pool=pool.filter(q=>sectionTopics.includes(q.topic));
    if(cfg.topic!=='all')pool=pool.filter(q=>q.topic===cfg.topic);
    if(cfg.mode==='errors')pool=pool.filter(q=>errSet.has(q.id));
    if(cfg.mode==='marked')pool=pool.filter(q=>marked.has(q.id));
    if(!pool.length)return alert('No hay preguntas para esta selección.');
    const s=shuffle(pool).slice(0,Math.min(cfg.n,pool.length));
    setSession(s);setIdx(0);setAnswers([]);setSelected(null);setRevealed(false);setStartTs(Date.now());setPhase('running');
  };

  if(phase==='setup'){
    const sTopics=cfg.section==='all'?null:SECTIONS.find(s=>s.id===cfg.section)?.topics;
    const topicsForSec=cfg.section==='all'?[...new Set(testQs.map(q=>q.topic))].sort():(sTopics||[]).filter(t=>testQs.some(q=>q.topic===t));
    return(
      <div style={{maxWidth:680}}>
        <h2 style={{fontSize:18,fontWeight:700,marginBottom:20,color:T.text,letterSpacing:-0.3}}>🧪 Configurar test</h2>
        <Lbl>Bloque temático</Lbl>
        <Sel value={cfg.section} onChange={v=>setCfg({...cfg,section:v,topic:'all'})}>
          <option value="all">Todos los bloques ({testQs.length} preg.)</option>
          {SECTIONS.map(s=>{const n=testQs.filter(q=>s.topics.includes(q.topic)).length;return n>0?<option key={s.id} value={s.id}>{s.emoji} {s.name} ({n})</option>:null;})}
        </Sel>
        {topicsForSec.length>0&&<><Lbl>Tema específico</Lbl><Sel value={cfg.topic} onChange={v=>setCfg({...cfg,topic:v})}><option value="all">Todos los temas</option>{topicsForSec.map(t=><option key={t} value={t}>{t} ({testQs.filter(q=>q.topic===t).length})</option>)}</Sel></>}
        <Lbl>Selección</Lbl>
        <RadioGroup value={cfg.mode} onChange={v=>setCfg({...cfg,mode:v})} options={[{value:'all',label:'Todas las preguntas'},{value:'errors',label:`Solo errores (${errSet.size})`},{value:'marked',label:`Solo marcadas (${marked.size})`}]}/>
        <Lbl>Número de preguntas</Lbl>
        <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
          {[10,20,30,50,100].map(n=><button key={n} onClick={()=>setCfg({...cfg,n})} style={{padding:'7px 16px',borderRadius:7,fontWeight:600,fontSize:13,cursor:'pointer',background:cfg.n===n?T.blue:T.surface,border:`1px solid ${cfg.n===n?T.blue:T.border}`,color:cfg.n===n?'#fff':T.muted,boxShadow:sh.sm,fontFamily:FONT}}>{n}</button>)}
        </div>
        <Lbl>Tiempo por pregunta</Lbl>
        <RadioGroup value={cfg.timer} onChange={v=>setCfg({...cfg,timer:Number(v)})} options={[{value:0,label:'Sin límite'},{value:30,label:'30 segundos'},{value:60,label:'1 minuto'},{value:90,label:'90 segundos'}]}/>
        <Btn onClick={start} disabled={testQs.length===0} style={{marginTop:4}}>Comenzar →</Btn>
        {testQs.length===0&&<p style={{color:T.amber,marginTop:10,fontSize:12}}>⚠️ Genera preguntas en Preguntas primero.</p>}
      </div>
    );
  }

  if(phase==='results'){
    const correct=answers.filter((a,i)=>a.selected===session[i]?.correct).length;
    const pct=Math.round(correct/session.length*100);
    const [detail,setDetail]=useState(false);
    useEffect(()=>{addSession({mode:'test',topics:[...new Set(session.map(q=>q.topic))],n:session.length,correct,wrong:answers.filter((a,i)=>a.selected!==null&&a.selected!==session[i]?.correct).length,blank:answers.filter(a=>a.selected===null).length,pct,score:correct,maxScore:session.length,duration:Math.round((Date.now()-startTs)/1000)});},[]);
    return(
      <div>
        <Card style={{textAlign:'center',padding:'32px 24px',marginBottom:24}}>
          <div style={{fontSize:48,marginBottom:10}}>{pct>=70?'🎉':pct>=50?'📚':'💪'}</div>
          <div style={{fontSize:52,fontWeight:800,color:pct>=70?T.green:pct>=50?T.amber:T.red,lineHeight:1,letterSpacing:-2}}>{pct}%</div>
          <div style={{fontSize:16,color:T.muted,marginTop:8}}>{correct} / {session.length} correctas</div>
          <div style={{fontSize:12,color:T.dim,marginTop:4}}>{pct>=70?'¡Por encima del umbral!':pct>=50?'Cerca del umbral, repasa errores.':'Refuerza este bloque.'}</div>
        </Card>
        <div style={{display:'flex',gap:10,justifyContent:'center',marginBottom:20}}>
          <Btn onClick={()=>{setPhase('setup');setAnswers([]);}}>Nuevo test</Btn>
          <Btn variant="ghost" onClick={()=>setDetail(!detail)}>{detail?'Ocultar':'Ver'} respuestas</Btn>
        </div>
        {detail&&session.map((q,i)=>{const a=answers[i];const ok=a?.selected===q.correct;return <Card key={q.id} style={{padding:'12px 16px',marginBottom:8,borderLeft:`3px solid ${ok?T.green:T.red}`}}><div style={{marginBottom:4}}><span style={{fontSize:10,background:T.blueS,color:T.blueText,padding:'2px 8px',borderRadius:20,fontWeight:600}}>{q.topic}</span></div><p style={{margin:'4px 0 6px',fontSize:13,color:T.text,lineHeight:1.5}}>{q.question}</p><p style={{margin:0,fontSize:13,color:ok?T.greenDk:T.redDk}}>{ok?'✅':'❌'} {q.options[q.correct]}{!ok&&a?.selected!=null&&<span style={{color:T.dim}}> · Tuya: {q.options[a.selected]??'—'}</span>}</p>{q.explanation&&<p style={{margin:'6px 0 0',fontSize:12,color:T.muted,fontStyle:'italic',lineHeight:1.5}}>{q.explanation}</p>}</Card>;})}
      </div>
    );
  }

  const q=session[idx];const OPT=['A','B','C','D'];
  return(
    <div style={{maxWidth:860}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:13,color:T.muted,fontWeight:500}}>Pregunta {idx+1}/{session.length}</span>
          {cfg.timer>0&&<span style={{background:timeLeft<=10?T.redS:T.blueS,color:timeLeft<=10?T.red:T.blue,border:`1px solid ${timeLeft<=10?'#e0b8b0':'#b0d0e0'}`,padding:'3px 10px',borderRadius:6,fontWeight:700,fontSize:13,transition:'all 0.3s'}}>⏱ {timeLeft}s</span>}
        </div>
        <button onClick={()=>toggleMark(q.id)} style={{background:'none',border:'none',cursor:'pointer',fontSize:18,color:marked.has(q.id)?T.amber:T.dim}}>{marked.has(q.id)?'🔖':'🏷️'}</button>
      </div>
      <div style={{background:T.border,borderRadius:4,height:5,marginBottom:20}}><div style={{background:`linear-gradient(90deg,${T.blue},${T.teal})`,width:`${(idx/session.length)*100}%`,height:'100%',borderRadius:4,transition:'width 0.3s'}}/></div>
      <span style={{fontSize:11,background:T.blueS,color:T.blueText,padding:'3px 10px',borderRadius:20,fontWeight:600}}>{q.topic}</span>
      <div style={{margin:'14px 0',fontSize:16,fontWeight:500,color:T.text,lineHeight:1.75}}>{q.question}</div>
      <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
        {q.options.map((opt,i)=>{
          let bg=T.surface,border=T.border,color=T.text,bl='3px solid transparent';
          if(revealed){if(i===q.correct){bg=T.greenS;border='#b0d8c0';color=T.greenText;bl=`3px solid ${T.green}`;}else if(i===selected&&i!==q.correct){bg=T.redS;border='#e0b8b0';color=T.redText;bl=`3px solid ${T.red}`;}}
          else if(selected===i){bg=T.blueS;border='#b0d0e0';color=T.blueText;bl=`3px solid ${T.blue}`;}
          return <button key={i} onClick={()=>!revealed&&handleReveal(i,session,idx)} disabled={revealed} style={{display:'flex',alignItems:'flex-start',gap:12,padding:'12px 16px',background:bg,border:`1px solid ${border}`,borderLeft:bl,borderRadius:8,cursor:revealed?'default':'pointer',color,textAlign:'left',fontSize:13,lineHeight:1.5,fontFamily:FONT,transition:'all 0.15s',boxShadow:sh.sm}}>
            <span style={{fontWeight:700,minWidth:20,color:revealed&&i===q.correct?T.green:T.dim}}>{OPT[i]}</span>
            <span style={{flex:1}}>{opt}</span>
            {revealed&&i===q.correct&&<span>✅</span>}
            {revealed&&i===selected&&i!==q.correct&&<span>❌</span>}
          </button>;
        })}
      </div>
      {revealed&&q.explanation&&<div style={{background:T.blueS,border:'1px solid #b0d0e0',borderLeft:`3px solid ${T.blue}`,borderRadius:8,padding:'12px 16px',marginBottom:16,fontSize:13,color:T.blueText,lineHeight:1.6}}><strong>💡 </strong>{q.explanation}</div>}
      {revealed&&<Btn onClick={()=>{setAnswers(prev=>[...prev,{selected,correct:q.correct}]);if(idx+1>=session.length)setPhase('results');else{setIdx(i=>i+1);setSelected(null);setRevealed(false);}}}>{idx+1>=session.length?'Ver resultados →':'Siguiente →'}</Btn>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SIMULACRO  ⚡ — examen completo con distribución por bloques
// ═══════════════════════════════════════════════════════════════════════════
function Simulacro({testQs,recordAnswer,addSession,sessions}){
  const [phase,setPhase]=useState('setup');
  const [cfg,setCfg]=useState({n:100,totalTime:120,penalty:'tercio',difficulty:'all',blockDist:{}});
  const [session,setSession]=useState([]);
  const [answers,setAnswers]=useState([]);
  const [current,setCurrent]=useState(0);
  const [markedQ,setMarkedQ]=useState(new Set());
  const [timeLeft,setTimeLeft]=useState(0);
  const [startTs,setStartTs]=useState(0);
  const [results,setResults]=useState(null);
  const timerRef=useRef(null);
  const submitRef=useRef(null);

  // Available blocks with question counts
  const blocks=useMemo(()=>SECTIONS.map(s=>({...s,count:testQs.filter(q=>s.topics.includes(q.topic)).length})).filter(b=>b.count>0),[testQs]);

  const penFactors={tercio:1/3,cuarto:1/4,ninguna:0};

  const calcScore=(ans,sess,pen)=>{
    let correct=0,wrong=0,blank=0;
    ans.forEach((a,i)=>{if(a===null)blank++;else if(a===sess[i]?.correct)correct++;else wrong++;});
    const score=Math.max(0,correct-wrong*penFactors[pen]);
    return{correct,wrong,blank,score:Math.round(score*100)/100,maxScore:sess.length,pct:Math.round(score/sess.length*100)};
  };

  const handleSubmit=useCallback((ans,sess,cfg)=>{
    clearInterval(timerRef.current);
    const r=calcScore(ans,sess,cfg.penalty);
    // Record answers to stats
    ans.forEach((a,i)=>{
      const q=sess[i];if(!q)return;
      const correct=a===q.correct;
      recordAnswer(q.id,q.topic,correct,a===null?0:correct?5:2,{seccion:q.seccion,subseccion:q.subseccion,tipo:q.tipo,fase:q.fase});
    });
    const sid=uid();
    r.sessionId=sid;
    setResults(r);
    addSession({mode:'simulacro',id:sid,topics:[...new Set(sess.map(q=>q.topic))],n:sess.length,...r,duration:Math.round((Date.now()-startTs)/1000),penalty:cfg.penalty,difficulty:cfg.difficulty,blockDist:cfg.blockDist});
    setPhase('results');
  },[recordAnswer,addSession,startTs]);

  useEffect(()=>{submitRef.current={handleSubmit,answers,session,cfg};},[handleSubmit,answers,session,cfg]);

  useEffect(()=>{
    if(phase!=='running')return;
    if(cfg.totalTime===0)return; // no timer for unlimited
    timerRef.current=setInterval(()=>{
      setTimeLeft(t=>{
        if(t<=1){clearInterval(timerRef.current);const{handleSubmit:hs,answers:a,session:s,cfg:c}=submitRef.current;hs(a,s,c);return 0;}
        return t-1;
      });
    },1000);
    return()=>clearInterval(timerRef.current);
  },[phase,cfg.totalTime]);

  const start=()=>{
    let pool=testQs;
    // Difficulty filter
    if(cfg.difficulty&&cfg.difficulty!=='all')pool=pool.filter(q=>(q.dificultad||'media')===cfg.difficulty);
    if(!pool.length)return alert('No hay preguntas para esta configuración.');

    // Block distribution
    const distKeys=Object.keys(cfg.blockDist||{}).filter(k=>cfg.blockDist[k]>0);
    let selected=[];
    if(distKeys.length>0){
      const totalPct=distKeys.reduce((a,k)=>a+cfg.blockDist[k],0);
      distKeys.forEach(secId=>{
        const pct=cfg.blockDist[secId]/totalPct;
        const nFromBlock=Math.round(cfg.n*pct);
        const sec=SECTIONS.find(s=>s.id===secId);
        if(!sec)return;
        const blockPool=pool.filter(q=>sec.topics.includes(q.topic));
        selected.push(...shuffle(blockPool).slice(0,nFromBlock));
      });
      // Fill remaining if rounding left gaps
      if(selected.length<cfg.n){const remaining=pool.filter(q=>!selected.some(s=>s.id===q.id));selected.push(...shuffle(remaining).slice(0,cfg.n-selected.length));}
      selected=shuffle(selected).slice(0,cfg.n);
    }else{
      selected=shuffle(pool).slice(0,Math.min(cfg.n,pool.length));
    }
    if(!selected.length)return alert('No hay suficientes preguntas.');
    setSession(selected);setAnswers(new Array(selected.length).fill(null));setCurrent(0);setMarkedQ(new Set());
    setTimeLeft(cfg.totalTime>0?cfg.totalTime*60:999999);setStartTs(Date.now());setPhase('running');
  };

  const selectAnswer=(i)=>{
    setAnswers(prev=>{const a=[...prev];a[current]=a[current]===i?null:i;return a;});
  };

  const toggleMarkQ=(i)=>{setMarkedQ(prev=>{const m=new Set(prev);m.has(i)?m.delete(i):m.add(i);return m;})};

  // ── Setup ──
  if(phase==='setup') return(
    <div style={{maxWidth:720}}>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:24}}>
        <div style={{width:40,height:40,borderRadius:10,background:T.orangeS,border:`0.5px solid ${T.orange}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20}}>⚡</div>
        <div><h2 style={{fontSize:18,fontWeight:700,margin:0,color:T.text,letterSpacing:-0.3}}>Simulacro de examen</h2><p style={{color:T.dim,fontSize:13,margin:0}}>Condiciones reales · sin feedback · penalización configurable</p></div>
      </div>

      <Lbl>Número de preguntas</Lbl>
      <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
        {[25,50,75,100].map(n=><button key={n} onClick={()=>setCfg(c=>({...c,n}))} style={{padding:'6px 16px',borderRadius:8,fontWeight:600,fontSize:13,cursor:'pointer',background:cfg.n===n?T.orange:T.surface,border:`0.5px solid ${cfg.n===n?T.orange:T.border}`,color:cfg.n===n?'#000':T.muted,fontFamily:FONT}}>{n}</button>)}
      </div>

      <Lbl>Tiempo límite</Lbl>
      <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
        {[{v:60,l:'60 min'},{v:90,l:'90 min'},{v:120,l:'120 min'},{v:0,l:'Sin límite'}].map(t=><button key={t.v} onClick={()=>setCfg(c=>({...c,totalTime:t.v}))} style={{padding:'6px 16px',borderRadius:8,fontWeight:600,fontSize:13,cursor:'pointer',background:cfg.totalTime===t.v?T.orange:T.surface,border:`0.5px solid ${cfg.totalTime===t.v?T.orange:T.border}`,color:cfg.totalTime===t.v?'#000':T.muted,fontFamily:FONT}}>{t.l}</button>)}
      </div>

      <Lbl>Dificultad</Lbl>
      <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
        {[{v:'all',l:'Aleatoria'},{v:'baja',l:'Baja'},{v:'media',l:'Media'},{v:'alta',l:'Alta'}].map(d=><button key={d.v} onClick={()=>setCfg(c=>({...c,difficulty:d.v}))} style={{padding:'6px 14px',borderRadius:8,fontWeight:600,fontSize:12,cursor:'pointer',background:cfg.difficulty===d.v?T.teal:T.surface,border:`0.5px solid ${cfg.difficulty===d.v?T.teal:T.border}`,color:cfg.difficulty===d.v?'#000':T.muted,fontFamily:FONT}}>{d.l}</button>)}
      </div>

      <Lbl>Distribución por bloques (opcional)</Lbl>
      <div style={{display:'flex',flexDirection:'column',gap:4,marginBottom:14}}>
        {blocks.map(b=>{
          const pct=cfg.blockDist[b.id]||0;
          return <div key={b.id} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0'}}>
            <span style={{fontSize:12,flex:1,color:T.text,minWidth:180}}>{b.emoji} {b.name} <span style={{color:T.dim,fontSize:10}}>({b.count})</span></span>
            <input type="range" min={0} max={100} step={5} value={pct} onChange={e=>setCfg(c=>({...c,blockDist:{...c.blockDist,[b.id]:parseInt(e.target.value)}}))}
              style={{width:100,accentColor:T.orange}}/>
            <span style={{fontSize:11,fontWeight:700,color:pct>0?T.orange:T.dim,minWidth:32,textAlign:'right'}}>{pct}%</span>
          </div>;
        })}
        <div style={{fontSize:10,color:T.dim,marginTop:2}}>Deja todo a 0% para distribución aleatoria.</div>
      </div>

      <Lbl>Sistema de puntuación</Lbl>
      <RadioGroup value={cfg.penalty} onChange={v=>setCfg(c=>({...c,penalty:v}))} options={[
        {value:'tercio',label:'✅ +1 · ❌ −1/3 · ⬜ 0 (OPE estándar SESCAM)'},
        {value:'cuarto',label:'✅ +1 · ❌ −1/4 · ⬜ 0'},
        {value:'ninguna',label:'✅ +1 · ❌ 0 · sin penalización'}
      ]}/>

      <Btn onClick={start} disabled={testQs.length<10} variant="orange" style={{marginTop:8}}>⚡ Comenzar simulacro →</Btn>
      {testQs.length<10&&<p style={{color:T.amber,marginTop:10,fontSize:12}}>⚠️ Necesitas al menos 10 preguntas test.</p>}

      {/* History chart */}
      {(()=>{
        const sims=(sessions||[]).filter(s=>s.mode==='simulacro').slice(0,10);
        if(!sims.length)return null;
        const maxPct=100;
        return(
          <Card style={{padding:'16px 20px',marginTop:20}}>
            <div style={{fontSize:12,fontWeight:700,color:T.text,marginBottom:10}}>📈 Evolución de simulacros</div>
            <div style={{display:'flex',alignItems:'flex-end',gap:4,height:80}}>
              {sims.reverse().map((s,i)=>(
                <div key={s.id||i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
                  <span style={{fontSize:9,fontWeight:700,color:s.pct>=70?T.green:s.pct>=50?T.amber:T.red}}>{s.pct}%</span>
                  <div style={{width:'100%',background:s.pct>=70?T.green:s.pct>=50?T.amber:T.red,borderRadius:4,height:`${Math.max(4,s.pct/maxPct*60)}px`,transition:'height 0.3s'}}/>
                  <span style={{fontSize:8,color:T.dim}}>{s.date?.slice(5,10)}</span>
                </div>
              ))}
            </div>
          </Card>
        );
      })()}
    </div>
  );

  // ── Results ──
  if(phase==='results'&&results) {
    // Block breakdown
    const blockResults=SECTIONS.map(sec=>{
      const secQs=session.map((q,i)=>({q,a:answers[i],i})).filter(({q})=>sec.topics.includes(q.topic));
      if(!secQs.length)return null;
      const c=secQs.filter(({q,a})=>a===q.correct).length;
      const w=secQs.filter(({q,a})=>a!==null&&a!==q.correct).length;
      return{name:sec.name,emoji:sec.emoji,total:secQs.length,correct:c,wrong:w,blank:secQs.length-c-w,pct:Math.round(c/secQs.length*100)};
    }).filter(Boolean);
    // Previous simulacro for comparison
    const prevSims=(sessions||[]).filter(s=>s.mode==='simulacro'&&s.id!==results.sessionId);
    const prevBest=prevSims.length?Math.max(...prevSims.map(s=>s.pct)):null;
    // Nota sobre 10
    const nota10=(results.score/results.maxScore*10).toFixed(2);

    return(
    <div>
      <Card style={{padding:'28px 32px',marginBottom:20,textAlign:'center'}}>
        <div style={{fontSize:11,fontWeight:700,color:T.orange,letterSpacing:1.5,textTransform:'uppercase',marginBottom:12}}>Resultado del simulacro</div>
        <div style={{display:'flex',justifyContent:'center',gap:28,marginBottom:20,flexWrap:'wrap'}}>
          <div><div style={{fontSize:48,fontWeight:800,color:results.pct>=70?T.green:results.pct>=50?T.amber:T.red,lineHeight:1,letterSpacing:-2}}>{nota10}</div><div style={{fontSize:12,color:T.muted,marginTop:4}}>Nota /10</div></div>
          <div style={{borderLeft:`0.5px solid ${T.border}`,paddingLeft:28}}><div style={{fontSize:24,fontWeight:700,color:T.green}}>{results.correct}</div><div style={{fontSize:11,color:T.dim}}>Correctas</div></div>
          <div><div style={{fontSize:24,fontWeight:700,color:T.red}}>{results.wrong}</div><div style={{fontSize:11,color:T.dim}}>Erróneas</div></div>
          <div><div style={{fontSize:24,fontWeight:700,color:T.dim}}>{results.blank}</div><div style={{fontSize:11,color:T.dim}}>En blanco</div></div>
        </div>
        <div style={{fontSize:12,color:T.dim,marginBottom:4}}>
          ({results.correct} − {results.wrong}×{cfg.penalty==='tercio'?'⅓':cfg.penalty==='cuarto'?'¼':'0'}) / {results.maxScore} × 10 = <strong style={{color:T.text}}>{nota10}</strong>
        </div>
        <div style={{fontSize:12,color:results.pct>=70?T.green:T.red,fontWeight:600,marginBottom:8}}>
          {results.pct>=70?'✅ Aprobado':'❌ Suspenso'} ({results.pct}%)
        </div>
        {prevBest!==null&&<div style={{fontSize:11,color:T.muted}}>Mejor anterior: {prevBest}% {results.pct>prevBest?<span style={{color:T.green}}>· ¡Nuevo récord!</span>:results.pct===prevBest?'· Igual':'· '+((results.pct-prevBest)>0?'+':'')+(results.pct-prevBest)+'%'}</div>}
      </Card>

      {/* Block breakdown */}
      {blockResults.length>1&&(
        <Card style={{padding:'16px 20px',marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:700,color:T.text,marginBottom:10}}>Desglose por bloque</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {blockResults.map(b=>(
              <div key={b.name} style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:14}}>{b.emoji}</span>
                <span style={{fontSize:11,color:T.text,flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.name}</span>
                <span style={{fontSize:10,color:T.dim}}>{b.correct}/{b.total}</span>
                <div style={{width:50}}><PBar pct={b.pct} color={b.pct>=70?T.green:b.pct>=50?T.amber:T.red} height={3}/></div>
                <span style={{fontSize:11,fontWeight:700,color:b.pct>=70?T.green:b.pct>=50?T.amber:T.red,minWidth:28,textAlign:'right'}}>{b.pct}%</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div style={{display:'flex',gap:10,justifyContent:'center',marginBottom:20}}>
        <Btn onClick={()=>{setPhase('setup');setResults(null);}} variant="orange">Nuevo simulacro</Btn>
      </div>
      {/* Review — failed questions with explanation */}
      <Card style={{padding:'14px 18px',marginBottom:16}}>
        <div style={{fontSize:12,fontWeight:700,color:T.text,marginBottom:10}}>Preguntas falladas ({results.wrong})</div>
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {session.map((q,i)=>{
            const a=answers[i];const ok=a===q.correct;const blank=a===null;
            if(ok||blank)return null;
            return <div key={q.id} style={{padding:'8px 12px',borderLeft:`2px solid ${T.red}`,borderRadius:4,background:T.bg}}>
              <div style={{display:'flex',gap:6,marginBottom:3}}><span style={{fontSize:9,background:T.blueS,color:T.blueText,padding:'1px 6px',borderRadius:10,fontWeight:600}}>{q.topic?.split('.')[0]||'—'}</span></div>
              <div style={{fontSize:12,color:T.text,lineHeight:1.5,marginBottom:3}}>{q.question}</div>
              <div style={{fontSize:11,color:T.red}}>Tu: {q.options[a]} → Correcta: <span style={{color:T.green}}>{q.options[q.correct]}</span></div>
              {q.explanation&&<div style={{fontSize:10,color:T.dim,marginTop:2,fontStyle:'italic'}}>{q.explanation}</div>}
            </div>;
          })}
        </div>
      </Card>
    </div>
  );}

  // ── Running ──
  const q=session[current];if(!q)return null;
  const OPT=['A','B','C','D'];
  const answered=answers.filter(a=>a!==null).length;
  const noTimeLimit=cfg.totalTime===0;
  const timeColor=noTimeLimit?T.dim:timeLeft<300?T.red:timeLeft<600?T.amber:T.teal;

  return(
    <div>
      {/* Top bar */}
      <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'12px 18px',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between',boxShadow:sh.sm,flexWrap:'wrap',gap:8}}>
        <div style={{display:'flex',alignItems:'center',gap:16}}>
          <div style={{textAlign:'center'}}>
            <div style={{fontSize:22,fontWeight:800,color:timeColor,fontVariantNumeric:'tabular-nums',letterSpacing:1}}>{noTimeLimit?'∞':fmtTime(timeLeft)}</div>
            <div style={{fontSize:10,color:T.dim,marginTop:-2}}>{noTimeLimit?'sin límite':'tiempo restante'}</div>
          </div>
          <div style={{width:1,height:36,background:T.border}}/>
          <div style={{textAlign:'center'}}>
            <div style={{fontSize:16,fontWeight:700,color:T.text}}>{answered}/{session.length}</div>
            <div style={{fontSize:10,color:T.dim}}>respondidas</div>
          </div>
          <div style={{textAlign:'center'}}>
            <div style={{fontSize:16,fontWeight:700,color:T.amber}}>{markedQ.size}</div>
            <div style={{fontSize:10,color:T.dim}}>marcadas</div>
          </div>
        </div>
        <Btn onClick={()=>{if(confirm(`¿Entregar el examen? Quedan ${session.length-answered} preguntas sin responder (contarán como blanco).`))handleSubmit(answers,session,cfg);}} variant="orange" style={{padding:'8px 20px'}}>Entregar examen</Btn>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 260px',gap:16,alignItems:'start'}}>
        {/* Question */}
        <div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <span style={{fontSize:11,background:T.blueS,color:T.blueText,padding:'3px 10px',borderRadius:20,fontWeight:600}}>{q.topic}</span>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <span style={{fontSize:13,color:T.muted}}>Pregunta {current+1}/{session.length}</span>
              <button onClick={()=>toggleMarkQ(current)} style={{background:markedQ.has(current)?T.amberS:'none',border:`1px solid ${markedQ.has(current)?T.amber:T.border}`,borderRadius:6,padding:'4px 10px',fontSize:12,cursor:'pointer',color:markedQ.has(current)?T.amber:T.dim,fontFamily:FONT}}>
                {markedQ.has(current)?'🔖 Marcada':'🏷️ Marcar'}
              </button>
            </div>
          </div>
          <div style={{margin:'14px 0',fontSize:16,fontWeight:500,color:T.text,lineHeight:1.75}}>{q.question}</div>
          <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
            {q.options.map((opt,i)=>{
              const sel=answers[current]===i;
              return <button key={i} onClick={()=>selectAnswer(i)} style={{display:'flex',alignItems:'flex-start',gap:12,padding:'12px 16px',background:sel?T.blueS:T.surface,border:`1px solid ${sel?T.blue:T.border}`,borderLeft:`3px solid ${sel?T.blue:'transparent'}`,borderRadius:8,cursor:'pointer',color:sel?T.blueText:T.text,textAlign:'left',fontSize:13,lineHeight:1.5,fontFamily:FONT,transition:'all 0.15s',boxShadow:sh.sm}}>
                <span style={{fontWeight:700,minWidth:20,color:sel?T.blue:T.dim}}>{OPT[i]}</span>
                <span style={{flex:1}}>{opt}</span>
                {sel&&<span style={{color:T.blue}}>●</span>}
              </button>;
            })}
          </div>
          <div style={{display:'flex',gap:10}}>
            <Btn variant="ghost" disabled={current===0} onClick={()=>setCurrent(c=>c-1)} style={{padding:'8px 16px'}}>← Anterior</Btn>
            <Btn variant="ghost" disabled={current===session.length-1} onClick={()=>setCurrent(c=>c+1)} style={{padding:'8px 16px'}}>Siguiente →</Btn>
          </div>
        </div>

        {/* Question grid */}
        <Card style={{padding:'14px'}}>
          <div style={{fontSize:11,fontWeight:700,color:T.muted,marginBottom:10,letterSpacing:0.5,textTransform:'uppercase'}}>Navegación</div>
          <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
            {session.map((_,i)=>{
              const isAnswered=answers[i]!==null;
              const isMark=markedQ.has(i);
              const isCur=i===current;
              return <button key={i} onClick={()=>setCurrent(i)} style={{width:28,height:28,borderRadius:5,fontSize:11,fontWeight:isCur?700:400,cursor:'pointer',fontFamily:FONT,transition:'all 0.1s',
                background:isCur?T.orange:isMark?T.amberS:isAnswered?T.blueS:T.card,
                border:`1.5px solid ${isCur?T.orange:isMark?T.amber:isAnswered?T.blue:T.border}`,
                color:isCur?'#fff':isMark?T.amber:isAnswered?T.blue:T.dim}}>{i+1}</button>;
            })}
          </div>
          <div style={{marginTop:12,display:'flex',flexDirection:'column',gap:5}}>
            {[{c:T.blue,bg:T.blueS,label:'Respondida'},{c:T.amber,bg:T.amberS,label:'Marcada'},{c:T.dim,bg:T.card,label:'Sin responder'},{c:'#fff',bg:T.orange,label:'Actual'}].map(l=><div key={l.label} style={{display:'flex',alignItems:'center',gap:6}}><div style={{width:12,height:12,borderRadius:3,background:l.bg,border:`1.5px solid ${l.c}`}}/><span style={{fontSize:11,color:T.muted}}>{l.label}</span></div>)}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FLASHCARD MODE
// ═══════════════════════════════════════════════════════════════════════════
function FlashcardMode({fcQs,dueQs,sr,marked,toggleMark,recordAnswer,addSession}){
  const [phase,setPhase]=useState('setup');
  const [mode,setMode]=useState('due');
  const [section,setSection]=useState('all');
  const [session,setSession]=useState([]);
  const [idx,setIdx]=useState(0);
  const [flipped,setFlipped]=useState(false);
  const [correct,setCorrect]=useState(0);
  const [startTs,setStartTs]=useState(0);

  const start=()=>{
    let pool=mode==='due'?dueQs:mode==='all'?fcQs:fcQs.filter(q=>(SECTIONS.find(s=>s.id===section)?.topics||[]).includes(q.topic));
    if(!pool.length)return alert('No hay flashcards para esta selección.');
    setSession(shuffle(pool));setIdx(0);setFlipped(false);setCorrect(0);setStartTs(Date.now());setPhase('running');
  };

  const rate=async quality=>{
    const q=session[idx];
    await recordAnswer(q.id,q.topic,quality>=3,quality,{seccion:q.seccion,subseccion:q.subseccion,tipo:q.tipo,fase:q.fase});
    if(quality>=3)setCorrect(c=>c+1);
    if(idx+1>=session.length){
      const c2=quality>=3?correct+1:correct;
      addSession({mode:'flashcard',topics:[...new Set(session.map(q=>q.topic))],n:session.length,correct:c2,wrong:session.length-c2,blank:0,pct:Math.round(c2/session.length*100),score:c2,maxScore:session.length,duration:Math.round((Date.now()-startTs)/1000)});
      setPhase('done');return;
    }
    setIdx(i=>i+1);setFlipped(false);
  };

  if(phase==='setup')return(
    <div style={{maxWidth:'100%'}}>
      <h2 style={{fontSize:18,fontWeight:700,marginBottom:20,color:T.text,letterSpacing:-0.3}}>🃏 Flashcards · Repaso espaciado SM-2</h2>
      <Lbl>Sesión</Lbl>
      <RadioGroup value={mode} onChange={setMode} options={[{value:'due',label:`📅 Pendientes de hoy (${dueQs.length})`},{value:'all',label:`🔄 Todas (${fcQs.length})`},{value:'section',label:'📂 Por bloque temático'}]}/>
      {mode==='section'&&<><Lbl>Bloque</Lbl><Sel value={section} onChange={setSection}>{SECTIONS.map(s=>{const n=fcQs.filter(q=>s.topics.includes(q.topic)).length;return<option key={s.id} value={s.id}>{s.emoji} {s.name} ({n})</option>;})}</Sel></>}
      <Btn onClick={start} disabled={fcQs.length===0} variant="teal">Empezar →</Btn>
      {fcQs.length===0&&<p style={{color:T.amber,marginTop:10,fontSize:12}}>⚠️ Genera flashcards en Preguntas primero.</p>}
    </div>
  );

  if(phase==='done')return(
    <Card style={{textAlign:'center',padding:'48px 24px'}}>
      <div style={{fontSize:48,marginBottom:12}}>🎓</div>
      <div style={{fontSize:20,fontWeight:700,color:T.text}}>¡Sesión completada!</div>
      <div style={{color:T.muted,marginTop:8,marginBottom:8,fontSize:14}}>Has repasado {session.length} flashcards</div>
      <div style={{fontSize:14,fontWeight:600,color:T.green,marginBottom:20}}>{correct}/{session.length} correctas ({Math.round(correct/session.length*100)}%)</div>
      <Btn variant="teal" onClick={()=>setPhase('setup')}>Nueva sesión</Btn>
    </Card>
  );

  if(idx>=session.length)return null;
  const q=session[idx];const srInfo=sr[q.id]||{};
  return(
    <div style={{maxWidth:'100%'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
        <span style={{color:T.muted,fontSize:13,fontWeight:500}}>Tarjeta {idx+1}/{session.length}</span>
        <div style={{display:'flex',gap:10,alignItems:'center'}}>
          {srInfo.reps>0&&<span style={{fontSize:11,color:T.dim,background:T.card,padding:'2px 8px',borderRadius:20}}>Rep. {srInfo.reps} · {srInfo.interval}d</span>}
          <button onClick={()=>toggleMark(q.id)} style={{background:'none',border:'none',cursor:'pointer',fontSize:18,color:marked.has(q.id)?T.amber:T.dim}}>{marked.has(q.id)?'🔖':'🏷️'}</button>
        </div>
      </div>
      <div style={{background:T.border,borderRadius:4,height:5,marginBottom:20}}><div style={{background:`linear-gradient(90deg,${T.teal},${T.green})`,width:`${(idx/session.length)*100}%`,height:'100%',borderRadius:4,transition:'width 0.3s'}}/></div>
      <div onClick={()=>setFlipped(!flipped)} style={{background:flipped?T.blueS:T.surface,border:`1.5px solid ${flipped?T.blue:T.border}`,borderTop:`4px solid ${flipped?T.blue:T.teal}`,borderRadius:12,padding:'36px 28px',minHeight:200,cursor:'pointer',textAlign:'center',transition:'all 0.25s',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',userSelect:'none',boxShadow:sh.md}}>
        {!flipped?<><div style={{fontSize:10,color:T.teal,fontWeight:700,letterSpacing:1.5,marginBottom:14,textTransform:'uppercase'}}>Pregunta · {q.topic}</div><div style={{fontSize:17,fontWeight:500,color:T.text,lineHeight:1.75}}>{q.front||q.question}</div><div style={{marginTop:20,fontSize:11,color:T.dim}}>Toca para ver la respuesta</div></>:<><div style={{fontSize:10,color:T.blue,fontWeight:700,letterSpacing:1.5,marginBottom:14,textTransform:'uppercase'}}>Respuesta</div><div style={{fontSize:15,color:T.blueText,lineHeight:1.8}}>{q.back||q.explanation||'—'}</div></>}
      </div>
      {flipped&&(
        <div style={{marginTop:20}}>
          <div style={{fontSize:12,color:T.muted,textAlign:'center',marginBottom:14}}>¿Cómo ha ido? El sistema ajusta el próximo repaso automáticamente.</div>
          <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap'}}>
            {[{q:0,l:'De nuevo',c:T.red,sub:'<1d',bg:T.redS,b:'#e0b8b0'},{q:2,l:'Difícil',c:T.amber,sub:'~1d',bg:T.amberS,b:'#d4b44a'},{q:4,l:'Bien',c:T.blue,sub:`~${srInfo.interval||1}d`,bg:T.blueS,b:'#b0d0e0'},{q:5,l:'Fácil',c:T.green,sub:'más días',bg:T.greenS,b:'#b0d8c0'}].map(r=>(
              <button key={r.q} onClick={()=>rate(r.q)} style={{background:r.bg,color:r.c,border:`1px solid ${r.b}`,borderRadius:8,padding:'10px 20px',cursor:'pointer',fontWeight:600,fontSize:13,display:'flex',flexDirection:'column',alignItems:'center',gap:3,fontFamily:FONT,boxShadow:sh.sm}}>
                {r.l}<span style={{fontSize:10,opacity:0.7}}>{r.sub}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EXAM PDF IMPORTER
// ═══════════════════════════════════════════════════════════════════════════
function ExamPdfImporter({qs,saveQs,apiKey}){
  const [file,setFile]=useState(null);
  const [loading,setLoading]=useState(false);
  const [msg,setMsg]=useState('');
  const [preview,setPreview]=useState(null);
  const fileRef=useRef(null);
  const [progress,setProgress]=useState(null); // {done,total}

  const BATCH=20;
  const DELAY=15000;

  const extractTextPrompt=`Extrae y transcribe el texto completo de este examen de oposición tal como aparece, incluyendo todos los enunciados, opciones y solucionario si existe. No resumas ni omitas nada. Solo texto plano.`;

  const makePrompt=(chunk,from,to,total)=>`Eres un experto en oposiciones FEA Laboratorio Clínico SESCAM 2025.
Tienes el texto de un examen oficial con ${total} preguntas en total.
Extrae ÚNICAMENTE las preguntas ${from} a ${to} del siguiente texto y conviértelas a JSON.

TEXTO DEL EXAMEN:
${chunk}

Para cada pregunta extrae:
- Enunciado completo
- Las 4 opciones (A, B, C, D) completas
- La respuesta correcta si aparece solucionario (índice 0=A,1=B,2=C,3=D) o null si no aparece
- El tema T1-T60 del temario SESCAM 2025 más apropiado

Responde ÚNICAMENTE con array JSON válido sin texto previo ni backticks:
[{"topic":"T18. Hidratos de carbono: metabolismo glucídico, diabetes mellitus, HbA1c, insulina, péptido C","type":"test","question":"Enunciado","options":["A","B","C","D"],"correct":0,"explanation":""}]`;

  const countPrompt=`Este es un examen oficial de oposición. Cuenta exactamente cuántas preguntas tipo test contiene y responde ÚNICAMENTE con un número entero. Nada más.`;

  const handleFile=e=>{
    const f=e.target.files?.[0];
    if(!f)return;
    if(f.size>50*1024*1024){setMsg('❌ El PDF supera 50 MB.');return;}
    setFile(f);setPreview(null);setMsg('');
  };

  const callAPI=async(prompt,pdfB64=null)=>{
    const content=[];
    if(pdfB64)content.push({type:'document',source:{type:'base64',media_type:'application/pdf',data:pdfB64}});
    content.push({type:'text',text:prompt});
    const res=await fetch('/api/anthropic',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:8192,messages:[{role:'user',content}]})
    });
    if(!res.ok){const d=await res.json().catch(()=>({}));throw new Error(d?.error?.message||`HTTP ${res.status}`);}
    const data=await res.json();
    return (data.content||[]).map(c=>c.text||'').join('').trim();
  };

  const extract=async()=>{
    if(!file)return;
    setLoading(true);setMsg('');setPreview(null);setProgress(null);
    try{
      const b64=await blobToB64(file);

      // Step 1: extract full text from PDF (one call with the PDF)
      setMsg('📄 Extrayendo texto del examen...');
      const fullText=await callAPI(extractTextPrompt,b64);
      if(!fullText||fullText.length<100)throw new Error('No se pudo extraer texto del PDF.');

      // Step 2: count questions from text (no PDF needed)
      setMsg('🔍 Contando preguntas...');
      await new Promise(r=>setTimeout(r,DELAY));
      const countText=await callAPI(`Del siguiente texto de examen, cuenta exactamente cuántas preguntas tipo test hay. Responde ÚNICAMENTE con un número entero.\n\n${fullText.slice(0,8000)}`);
      const total=parseInt(countText.replace(/\D/g,''));
      if(!total||total>300)throw new Error(`No se pudo determinar el número de preguntas.`);

      // Step 3: split text into chunks and process each batch (no PDF)
      const lines=fullText.split('\n');
      const chunkSize=Math.ceil(lines.length/Math.ceil(total/BATCH));
      const batches=Math.ceil(total/BATCH);
      setMsg(`📊 ${total} preguntas · Procesando en ${batches} lotes...`);
      setProgress({done:0,total:batches});

      const all=[];
      for(let b=0;b<batches;b++){
        const from=b*BATCH+1;
        const to=Math.min((b+1)*BATCH,total);
        const chunkStart=b*chunkSize;
        const chunk=lines.slice(chunkStart,chunkStart+chunkSize+50).join('\n');

        if(b>0){
          for(let t=DELAY/1000;t>0;t--){
            setMsg(`⏳ Lote ${b}/${batches} completado · Esperando ${t}s...`);
            await new Promise(r=>setTimeout(r,1000));
          }
        }
        setMsg(`🤖 Procesando preguntas ${from}–${to} (lote ${b+1}/${batches})...`);
        const text=await callAPI(makePrompt(chunk,from,to,total));
        const cleaned=text.replace(/```json|```/g,'').trim();
        try{
          const parsed=JSON.parse(repairJSON(cleaned));
          if(Array.isArray(parsed))all.push(...parsed);
        }catch(e){console.warn(`Lote ${b+1} falló:`,e.message);}
        setProgress({done:b+1,total:batches});
      }

      if(!all.length)throw new Error('No se encontraron preguntas.');
      setPreview(all);
      setMsg(`✅ ${all.length} preguntas extraídas. Revisa y confirma.`);
    }catch(e){setMsg(`❌ ${e.message}`);}
    setLoading(false);setProgress(null);
  };

  const confirm=async()=>{
    if(!preview)return;
    const withIds=preview.map(q=>({...q,id:uid(),correct:q.correct??0}));
    await saveQs([...qs,...withIds]);
    setMsg(`✅ ${withIds.length} preguntas importadas.`);
    setPreview(null);setFile(null);
  };

  const nullCount=preview?.filter(q=>q.correct===null).length||0;

  return(
    <div style={{maxWidth:800}}>
      <h3 style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:6}}>📄 Importar examen oficial PDF</h3>
      <p style={{color:T.muted,fontSize:13,marginBottom:20,lineHeight:1.6}}>Sube un PDF de examen oficial. La IA extrae todas las preguntas automáticamente en lotes y las añade con el tema asignado.</p>

      <div onClick={()=>fileRef.current?.click()}
        style={{border:`2px dashed ${file?T.green:T.border}`,borderRadius:12,padding:'28px 20px',textAlign:'center',cursor:'pointer',background:file?T.greenS:T.card,transition:'all 0.2s',marginBottom:16}}>
        <div style={{fontSize:32,marginBottom:8}}>{file?'📄':'⬆️'}</div>
        {file?(
          <div>
            <div style={{fontWeight:600,color:T.greenText,fontSize:14}}>{file.name}</div>
            <div style={{fontSize:12,color:T.muted,marginTop:2}}>{(file.size/1024/1024).toFixed(1)} MB</div>
          </div>
        ):(
          <div>
            <div style={{fontWeight:600,color:T.muted,fontSize:14}}>Haz clic para seleccionar el PDF del examen</div>
            <div style={{fontSize:12,color:T.dim,marginTop:4}}>Exámenes oficiales OPE/MIR · Máx. 50 MB</div>
          </div>
        )}
        <input ref={fileRef} type="file" accept=".pdf" onChange={handleFile} style={{display:'none'}}/>
      </div>

      {file&&!preview&&<Btn onClick={extract} disabled={loading} variant="green">{loading?'⏳ Procesando...':'🤖 Extraer preguntas con IA'}</Btn>}

      {progress&&(
        <div style={{marginTop:12,background:T.card,borderRadius:8,padding:'10px 14px',border:`1px solid ${T.border}`}}>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:T.muted,marginBottom:6}}>
            <span>Lote {progress.done} de {progress.total}</span>
            <span style={{fontWeight:600,color:T.green}}>{Math.round(progress.done/progress.total*100)}%</span>
          </div>
          <div style={{background:T.border,borderRadius:4,height:6,overflow:'hidden'}}>
            <div style={{background:`linear-gradient(90deg,${T.green},${T.teal})`,width:`${Math.round(progress.done/progress.total*100)}%`,height:'100%',borderRadius:4,transition:'width 0.5s'}}/>
          </div>
        </div>
      )}

      {msg&&<div style={{marginTop:12,fontSize:13,color:msg.startsWith('❌')?T.red:msg.startsWith('✅')?T.green:T.muted,padding:'8px 12px',background:msg.startsWith('❌')?T.redS:msg.startsWith('✅')?T.greenS:T.card,borderRadius:8,border:`1px solid ${msg.startsWith('❌')?'#e0b8b0':msg.startsWith('✅')?'#b0d8c0':T.border}`}}>{msg}</div>}

      {preview&&(
        <div style={{marginTop:20}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
            <div>
              <span style={{fontWeight:700,fontSize:14,color:T.text}}>{preview.length} preguntas extraídas</span>
              {nullCount>0&&<span style={{marginLeft:8,fontSize:12,color:T.amber}}>⚠️ {nullCount} sin respuesta correcta</span>}
            </div>
            <div style={{display:'flex',gap:8}}>
              <Btn variant="ghost" onClick={()=>{setPreview(null);setMsg('');}}>Descartar</Btn>
              <Btn variant="green" onClick={confirm}>✅ Importar {preview.length} preguntas →</Btn>
            </div>
          </div>
          {nullCount>0&&<div style={{background:T.amberS,border:`1px solid ${T.amber}`,borderRadius:8,padding:'8px 12px',fontSize:12,color:T.amberText,marginBottom:12}}>⚠️ Sin solucionario en el PDF. Las preguntas se importan con opción A por defecto — corrígelas en Preguntas.</div>}
          <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:400,overflowY:'auto'}}>
            {preview.slice(0,20).map((q,i)=>(
              <div key={i} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:'10px 14px'}}>
                <div style={{display:'flex',gap:8,alignItems:'flex-start',marginBottom:6}}>
                  <span style={{fontSize:10,background:T.blueS,color:T.blueText,padding:'2px 7px',borderRadius:20,fontWeight:600,flexShrink:0}}>{q.topic?.split('.')[0]||'?'}</span>
                  <span style={{fontSize:12,color:T.text,fontWeight:500,lineHeight:1.4}}>{q.question}</span>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:4,paddingLeft:4}}>
                  {(q.options||[]).map((opt,j)=>(
                    <div key={j} style={{fontSize:11,color:q.correct===j?T.greenText:T.muted,background:q.correct===j?T.greenS:'transparent',borderRadius:5,padding:'2px 6px'}}>
                      <span style={{fontWeight:700}}>{['A','B','C','D'][j]}.</span> {opt}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {preview.length>20&&<div style={{textAlign:'center',fontSize:12,color:T.dim,padding:8}}>... y {preview.length-20} más</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// BANK MANAGER
// ═══════════════════════════════════════════════════════════════════════════
function BankManager({qs,saveQs,preselect,onPreselect,pdfMeta,apiKey}){
  const [subTab,setSubTab]=useState('ai');
  const [fSection,setFSection]=useState('all');
  const [fType,setFType]=useState('all');
  const [selSection,setSelSection]=useState(preselect?.section||null);
  const [aiTopic,setAiTopic]=useState(preselect?.topic||'');
  const [aiType,setAiType]=useState('test');
  const [aiN,setAiN]=useState(5);
  const [aiLoading,setAiLoading]=useState(false);
  const [aiMsg,setAiMsg]=useState('');
  const [batchProgress,setBatchProgress]=useState(null); // {done,total,current}
  const [pdfFile,setPdfFile]=useState(null);
  const [pdfName,setPdfName]=useState('');
  const [selectedPdfIds,setSelectedPdfIds]=useState(new Set()); // IDs seleccionados para esta generación
  const [upText,setUpText]=useState('');
  const [upMsg,setUpMsg]=useState('');
  const fileRef=useRef(null);

  useEffect(()=>{if(preselect){setSelSection(preselect.section);setAiTopic(preselect.topic||'');setSubTab('ai');onPreselect?.();}},[preselect]);

  // Cuando cambia el tema, seleccionar todos los PDFs adjuntos por defecto
  const attachedPdfFiles=aiTopic?(pdfMeta[topicPdfKey(aiTopic)]||[]):[];
  useEffect(()=>{
    setSelectedPdfIds(new Set(attachedPdfFiles.map(f=>f.id)));
  },[aiTopic,JSON.stringify(attachedPdfFiles.map(f=>f.id))]);
  const hasAttached=attachedPdfFiles.length>0;
  const selectedFiles=attachedPdfFiles.filter(f=>selectedPdfIds.has(f.id));
  const usingAttachedPdf=!pdfFile&&hasAttached;
  const nSelected=pdfFile?1:selectedFiles.length;
  const effectivePdfLabel=pdfFile?pdfFile.name:nSelected>0?`${nSelected} PDF${nSelected>1?'s':''} seleccionado${nSelected>1?'s':''}`:null;

  const togglePdfId=id=>setSelectedPdfIds(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});

  const filtered=qs.filter(q=>{const sec=fSection==='all'||(SECTIONS.find(s=>s.id===fSection)?.topics.includes(q.topic));return sec&&(fType==='all'||q.type===fType);});

  const handlePdfSelect=e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>80*1024*1024){alert('PDF > 80 MB');return;}setPdfFile(f);setPdfName(f.name);setAiMsg('');};
  const removePdf=()=>{setPdfFile(null);setPdfName('');if(fileRef.current)fileRef.current.value='';};

  const exportJSON=()=>{
    const blob=new Blob([JSON.stringify(qs,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=`preguntas_opelab_${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);
  };

  const generateAI=async()=>{
    if(!aiTopic.trim())return alert('Elige o escribe un tema.');
    setAiLoading(true);setAiMsg('');
    const isTest=aiType==='test';
    const jsonFmt=isTest?`[{"id":"x","topic":"${aiTopic}","type":"test","question":"...","options":["A","B","C","D"],"correct":0,"explanation":"explicación técnica con datos concretos"}]`:`[{"id":"x","topic":"${aiTopic}","type":"flashcard","front":"concepto breve","back":"respuesta completa con valores y mecanismos"}]`;

    // Resolver fuentes de conocimiento PDF
    let pdfBlobs=[];
    if(pdfFile){
      setAiMsg('📄 Procesando PDF...');
      const chunks=await splitPdfIfNeeded(pdfFile);
      pdfBlobs=[chunks[0].file];
    } else if(hasAttached&&selectedFiles.length>0){
      setAiMsg(`📂 Cargando y fusionando ${selectedFiles.length} PDF${selectedFiles.length>1?'s':''}...`);
      const rawBlobs=[];
      for(const f of selectedFiles){
        const blob=await idbLoad(topicFilePdfKey(aiTopic,f.id)).catch(()=>null);
        if(blob)rawBlobs.push(blob instanceof File?blob:new File([blob],f.name,{type:'application/pdf'}));
      }
      if(rawBlobs.length>0){
        const {file,pages}=await mergePdfsWithLimit(rawBlobs);
        pdfBlobs=[file];
        setAiMsg(`📄 ${pages} páginas fusionadas — generando...`);
        await new Promise(r=>setTimeout(r,600));
      }
    }

    const hasPdfs=pdfBlobs.length>0;
    const nDocs=pdfBlobs.length;

    const promptPdf=`Eres el mejor preparador de oposiciones FEA Laboratorio Clínico de España, con 20 años de experiencia analizando exámenes reales del sistema MIR y OPE. Tienes delante un fragmento del Tietz o Henry sobre el tema "${aiTopic}" (temario SESCAM 2025).

Tu misión: generar exactamente ${aiN} ${isTest?'preguntas tipo test':'flashcards'} de MÁXIMA CALIDAD extrayendo los datos más importantes del documento adjunto.

${isTest?`REQUISITOS PARA CADA PREGUNTA TEST:
1. ENUNCIADO: Planteado como caso clínico real o situación de laboratorio concreta. Nunca preguntas del tipo "¿Cuál es la definición de X?". Usa frases como: "Un paciente con..., ¿cuál sería el resultado esperado?", "En el laboratorio se recibe una muestra con..., ¿qué indica?", "¿Cuál de los siguientes valores es diagnóstico de...?".
2. OPCIONES: 4 opciones (A-D). Todas deben ser plausibles técnicamente. Los distractores deben ser errores reales que comete un estudiante que no ha estudiado bien el tema, no respuestas absurdas.
3. RESPUESTA CORRECTA: Basada en datos concretos del documento (valores numéricos, clasificaciones, mecanismos).
4. EXPLICACIÓN: Mínimo 3 frases. Debe incluir: (a) por qué es correcta la respuesta con el dato concreto del libro, (b) por qué son incorrectas las otras opciones, (c) un dato adicional relevante del tema.

TIPOS DE PREGUNTAS A INCLUIR (varía entre estos):
- Interpretación de resultados numéricos (valores de referencia, puntos de corte diagnósticos)
- Mecanismos fisiopatológicos (¿qué enzima/proteína/vía está alterada?)
- Diagnóstico diferencial (¿qué prueba confirmaría/descartaría?)
- Interferencias analíticas y preanalítica
- Principios metodológicos e instrumentación
- Correlación clinicoanálítica (síntoma + resultado → diagnóstico)`:
`REQUISITOS PARA CADA FLASHCARD:
- ANVERSO (front): Concepto técnico concreto formulado como pregunta directa. Incluye contexto clínico cuando sea posible.
- REVERSO (back): Respuesta completa con: valor numérico exacto O mecanismo específico O clasificación con criterios. Mínimo 2-3 frases. Añade un dato nemotécnico o perla clínica si existe.`}

ESTÁNDARES DE CALIDAD INAMOVIBLES:
✓ Cada pregunta debe contener al menos UN dato que solo conoce quien ha estudiado el libro (valor numérico exacto, nombre de enzima/proteína específica, porcentaje, tiempo, clasificación con criterios)
✓ Nivel de dificultad: apto para examen FEA real (escala 7-9/10 de dificultad)
✓ Terminología en español médico correcto
✗ PROHIBIDO: preguntas de cultura general, definiciones simples, datos obvios para cualquier graduado en Ciencias de la Salud`;

    const promptNoPdf=`Eres el mejor preparador de oposiciones FEA Laboratorio Clínico de España, con 20 años de experiencia analizando exámenes reales del sistema MIR y OPE. Conoces en profundidad el Tietz Textbook of Laboratory Medicine (Rifai et al., 2022) y el Henry El Laboratorio en el Diagnóstico Clínico (McPherson & Pincus, 2022).

Tu misión: generar exactamente ${aiN} ${isTest?'preguntas tipo test':'flashcards'} de MÁXIMA CALIDAD sobre el tema "${aiTopic}" del temario oficial SESCAM 2025 (Anexo II, DOCM 9/04/2025), como si las extrajeras directamente de esos libros.

${isTest?`REQUISITOS PARA CADA PREGUNTA TEST:
1. ENUNCIADO: Planteado como caso clínico real o situación de laboratorio concreta. Nunca preguntas del tipo "¿Cuál es la definición de X?". Usa frases como: "Un paciente con..., ¿cuál sería el resultado esperado?", "En el laboratorio se recibe una muestra con..., ¿qué indica?", "¿Cuál de los siguientes valores es diagnóstico de...?".
2. OPCIONES: 4 opciones (A-D). Todas deben ser plausibles técnicamente. Los distractores deben ser errores reales que comete un estudiante que no ha estudiado bien el tema, no respuestas absurdas.
3. RESPUESTA CORRECTA: Basada en datos concretos del Tietz o Henry (valores numéricos, clasificaciones, mecanismos).
4. EXPLICACIÓN: Mínimo 3 frases. Debe incluir: (a) por qué es correcta la respuesta con el dato concreto del libro, (b) por qué son incorrectas las otras opciones, (c) un dato adicional relevante del tema.

TIPOS DE PREGUNTAS A INCLUIR (varía entre estos):
- Interpretación de resultados numéricos (valores de referencia, puntos de corte diagnósticos)
- Mecanismos fisiopatológicos (¿qué enzima/proteína/vía está alterada?)
- Diagnóstico diferencial (¿qué prueba confirmaría/descartaría?)
- Interferencias analíticas y fase preanalítica
- Principios metodológicos e instrumentación del laboratorio
- Correlación clínico-analítica (síntoma + resultado → diagnóstico)`:
`REQUISITOS PARA CADA FLASHCARD:
- ANVERSO (front): Concepto técnico concreto formulado como pregunta directa. Incluye contexto clínico cuando sea posible.
- REVERSO (back): Respuesta completa con: valor numérico exacto O mecanismo específico O clasificación con criterios. Mínimo 2-3 frases. Añade un dato nemotécnico o perla clínica si existe.`}

ESTÁNDARES DE CALIDAD INAMOVIBLES:
✓ Cada pregunta debe contener al menos UN dato que solo conoce quien ha estudiado Tietz/Henry (valor numérico exacto, nombre de enzima/proteína específica, porcentaje, tiempo, clasificación con criterios)
✓ Nivel de dificultad: apto para examen FEA real (escala 7-9/10 de dificultad)
✓ Terminología en español médico correcto
✓ Distribuye las preguntas entre distintos subapartados del tema, no repitas el mismo concepto
✗ PROHIBIDO: preguntas de cultura general, definiciones simples, datos obvios para cualquier graduado en Ciencias de la Salud`;

    const basePrompt=hasPdfs?promptPdf:promptNoPdf;

    // ── Batching automático ─────────────────────────────────────────────────
    const BATCH_SIZE=10;
    const BATCH_DELAY_MS=15000;
    const totalBatches=Math.ceil(aiN/BATCH_SIZE);
    const allGenerated=[];

    // Preparar PDF base64 una sola vez
    let pdfContent=null;
    if(pdfBlobs.length>0){
      const b64=await blobToB64(pdfBlobs[0]);
      pdfContent={type:'document',source:{type:'base64',media_type:'application/pdf',data:b64}};
    }

    setBatchProgress({done:0,total:totalBatches,current:0});

    for(let batch=0;batch<totalBatches;batch++){
      const nThisBatch=Math.min(BATCH_SIZE,aiN-batch*BATCH_SIZE);
      setBatchProgress({done:batch,total:totalBatches,current:nThisBatch});

      if(batch>0){
        for(let t=BATCH_DELAY_MS/1000;t>0;t--){
          setAiMsg(`⏳ Lote ${batch}/${totalBatches} completado · Esperando ${t}s...`);
          await new Promise(r=>setTimeout(r,1000));
        }
      }

      setAiMsg(`🤖 Generando lote ${batch+1}/${totalBatches} (${nThisBatch} preguntas)...`);

      const jsonFmtBatch=isTest
        ?`[{"id":"x","topic":"${aiTopic}","type":"test","question":"...","options":["A","B","C","D"],"correct":0,"explanation":"explicación técnica con datos concretos"}]`
        :`[{"id":"x","topic":"${aiTopic}","type":"flashcard","front":"concepto breve","back":"respuesta completa con valores y mecanismos"}]`;

      const antiRepeat=allGenerated.length>0?` Ya se generaron ${allGenerated.length} preguntas en lotes anteriores — genera preguntas DIFERENTES sobre distintos subapartados, sin repetir conceptos ya cubiertos.`:'';
      const fullPrompt=`${basePrompt}\n\nResponde ÚNICAMENTE con array JSON válido, sin texto previo ni posterior, sin backticks:\n${jsonFmtBatch}\n\nGenera exactamente ${nThisBatch} objetos.${antiRepeat}`;

      try{
        const content=[];
        if(pdfContent) content.push(pdfContent);
        content.push({type:'text',text:fullPrompt});
        const res=await fetch('/api/anthropic',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:8000,messages:[{role:'user',content}]})
        });
        if(!res.ok){
          const errData=await res.json().catch(()=>({}));
          const errMsg=errData?.error?.message||`HTTP ${res.status}`;
          if(allGenerated.length>0){
            const withIds=allGenerated.map(q=>({...q,id:uid()}));
            await saveQs([...qs,...withIds]);
            setAiMsg(`⚠️ Error en lote ${batch+1}: ${errMsg}. Se guardaron ${allGenerated.length} preguntas previas.`);
          }else{setAiMsg(`❌ Error de API: ${errMsg}`);}
          setAiLoading(false);setBatchProgress(null);return;
        }
        const data=await res.json();
        const text=(data.content||[]).map(c=>c.text||'').join('').trim();
        const generated=JSON.parse(text.replace(/```json|```/g,'').trim());
        allGenerated.push(...generated);
        setAiMsg(`✅ Lote ${batch+1}/${totalBatches} — ${allGenerated.length}/${aiN} preguntas generadas`);
      }catch(e){
        console.error(e);
        if(allGenerated.length>0){
          const withIds=allGenerated.map(q=>({...q,id:uid()}));
          await saveQs([...qs,...withIds]);
          setAiMsg(`⚠️ ${e.message} — se guardaron ${allGenerated.length} preguntas.`);
        }else{setAiMsg(`❌ ${e.message}`);}
        setAiLoading(false);setBatchProgress(null);return;
      }
    }

    const withIds=allGenerated.map(q=>({...q,id:uid()}));
    await saveQs([...qs,...withIds]);
    const src=hasPdfs?' desde PDF':' (Tietz/Henry)';
    setAiMsg(`✅ ${withIds.length} preguntas añadidas${src} en ${totalBatches} lote${totalBatches>1?'s':''}.`);
    removePdf();
    setBatchProgress(null);
    setAiLoading(false);
  };

  const importJSON=async()=>{try{const p=JSON.parse(upText);if(!Array.isArray(p))throw new Error('Debe ser array []');await saveQs([...qs,...p.map(q=>({...q,id:q.id||uid()}))]);setUpMsg(`✅ ${p.length} importadas.`);setUpText('');}catch(e){setUpMsg('❌ JSON inválido: '+e.message);}};

  const inputSt={width:'100%',background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:7,padding:'9px 12px',fontSize:13,outline:'none',marginBottom:14,boxSizing:'border-box',fontFamily:FONT,boxShadow:sh.sm};

  // Contar cuántos temas del selector tienen PDF adjunto
  const currentSectionTopics=selSection?SECTIONS.find(s=>s.id===selSection)?.topics||[]:[];
  const topicsWithPdf=new Set(Object.entries(pdfMeta).filter(([,v])=>Array.isArray(v)&&v.length>0).map(([k])=>ALL_TOPICS.find(t=>topicPdfKey(t)===k)||'').filter(Boolean));

  return(
    <div>
      <div style={{display:'flex',borderBottom:`1px solid ${T.border}`,marginBottom:22,gap:0}}>
        {[{id:'ai',label:'🤖 Generar con IA'},{id:'exam',label:'📄 Importar examen PDF'},{id:'list',label:`📋 Preguntas (${qs.length})`},{id:'upload',label:'📤 Importar JSON'}].map(t=><button key={t.id} onClick={()=>setSubTab(t.id)} style={{padding:'10px 14px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:subTab===t.id?600:400,color:subTab===t.id?T.blue:T.muted,borderBottom:`2px solid ${subTab===t.id?T.blue:'transparent'}`,fontFamily:FONT}}>{t.label}</button>)}
      </div>

      {subTab==='ai'&&(
        <div style={{maxWidth:720}}>
          <p style={{color:T.muted,fontSize:13,marginTop:0,marginBottom:20,lineHeight:1.6}}>Selecciona bloque y tema. Si el tema tiene un PDF adjunto (desde el Temario), se cargará automáticamente como fuente de conocimiento.</p>
          <Lbl>1. Bloque temático (SESCAM 2025)</Lbl>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(175px,1fr))',gap:6,marginBottom:18}}>
            {SECTIONS.map(s=>{
              const nPdfs=s.topics.reduce((sum,t)=>{const arr=pdfMeta[topicPdfKey(t)];return sum+(Array.isArray(arr)?arr.length:0);},0);
              return <button key={s.id} onClick={()=>{setSelSection(s.id);setAiTopic(s.topics[0]);}} style={{background:selSection===s.id?s.colorS:T.surface,border:`1.5px solid ${selSection===s.id?s.color:T.border}`,borderLeft:`3px solid ${s.color}`,color:selSection===s.id?s.color:T.muted,borderRadius:8,padding:'8px 10px',fontSize:12,cursor:'pointer',textAlign:'left',fontFamily:FONT,boxShadow:sh.sm,position:'relative'}}>
                {s.emoji} {s.name}
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:3}}>
                  <span style={{fontSize:10,opacity:0.6}}>T{s.temas[0]}{s.temas.length>1?`–T${s.temas[s.temas.length-1]}`:''}</span>
                  {nPdfs>0&&<span style={{fontSize:9,background:T.greenS,color:T.greenText,padding:'1px 5px',borderRadius:10,fontWeight:700}}>📄 {nPdfs}</span>}
                </div>
              </button>;
            })}
          </div>

          {selSection&&<><Lbl>2. Tema específico</Lbl>
            <div style={{display:'flex',flexDirection:'column',gap:5,marginBottom:16,maxHeight:220,overflowY:'auto',paddingRight:4}}>
              {currentSectionTopics.map(t=>{
                const hasPdfAttached=topicsWithPdf.has(t);
                return <label key={t} style={{display:'flex',alignItems:'flex-start',gap:8,cursor:'pointer',padding:'7px 10px',borderRadius:7,background:aiTopic===t?T.blueS:'transparent',border:`1px solid ${aiTopic===t?T.blue:hasPdfAttached?'#b0d8c0':T.border}`}}>
                  <input type="radio" checked={aiTopic===t} onChange={()=>setAiTopic(t)} style={{marginTop:3,flexShrink:0,accentColor:T.blue}}/>
                  <span style={{fontSize:13,color:aiTopic===t?T.blue:T.text,lineHeight:1.4,fontWeight:aiTopic===t?500:400,flex:1}}>{t}</span>
                  {hasPdfAttached&&<span title={`${pdfMeta[topicPdfKey(t)]?.length||0} PDF(s) adjuntos`} style={{fontSize:10,background:T.greenS,color:T.greenText,padding:'1px 6px',borderRadius:10,fontWeight:700,flexShrink:0}}>📄 {pdfMeta[topicPdfKey(t)]?.length||0}</span>}
                </label>;
              })}
            </div></>}

          <Lbl>{selSection?'3.':'2.'} O escribe un tema libre</Lbl>
          <input value={aiTopic} onChange={e=>setAiTopic(e.target.value)} onKeyDown={e=>e.key==='Enter'&&generateAI()} placeholder="Ej: T15. Interpretación gasometría arterial..." style={inputSt}/>

          {/* PDF source: adjunto automático o manual */}
          <Lbl>{selSection?'4.':'3.'} Fuente de conocimiento (PDF del capítulo)</Lbl>
          {usingAttachedPdf&&(
            <div style={{background:T.greenS,border:'1px solid #b0d8c0',borderLeft:`3px solid ${T.green}`,borderRadius:8,padding:'10px 14px',marginBottom:10}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <span style={{fontSize:16}}>📗</span>
                  <span style={{fontSize:13,color:T.greenText,fontWeight:600}}>PDFs adjuntos — selecciona cuáles usar</span>
                </div>
                <div style={{display:'flex',gap:6}}>
                  <button onClick={()=>setSelectedPdfIds(new Set(attachedPdfFiles.map(f=>f.id)))} style={{fontSize:10,background:'none',border:`1px solid ${T.border2}`,borderRadius:5,padding:'2px 7px',cursor:'pointer',color:T.muted,fontFamily:FONT}}>Todo</button>
                  <button onClick={()=>setSelectedPdfIds(new Set())} style={{fontSize:10,background:'none',border:`1px solid ${T.border2}`,borderRadius:5,padding:'2px 7px',cursor:'pointer',color:T.muted,fontFamily:FONT}}>Ninguno</button>
                </div>
              </div>
              {attachedPdfFiles.map(f=>{
                const sel=selectedPdfIds.has(f.id);
                const mb=(f.size/1024/1024).toFixed(1);
                return(
                  <label key={f.id} style={{display:'flex',alignItems:'center',gap:8,background:sel?'#d4f0e0':T.card,borderRadius:6,padding:'5px 8px',marginBottom:3,cursor:'pointer',border:`1px solid ${sel?'#b0d8c0':T.border}`,transition:'all 0.15s'}}>
                    <input type="checkbox" checked={sel} onChange={()=>togglePdfId(f.id)} style={{accentColor:T.green,flexShrink:0}}/>
                    <span style={{fontSize:11,color:sel?T.greenText:T.muted,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:sel?600:400}}>📄 {f.name}</span>
                    <span style={{fontSize:10,color:T.dim,flexShrink:0}}>{mb} MB</span>
                  </label>
                );
              })}
              {selectedFiles.length===0&&<div style={{fontSize:11,color:T.amber,marginTop:4,padding:'4px 8px',background:'#fdf6e3',borderRadius:5}}>⚠️ Ningún PDF seleccionado — se generará sin fuente del libro</div>}
              {selectedFiles.length>0&&<div style={{fontSize:11,color:T.greenText,marginTop:6,fontWeight:600}}>{selectedFiles.length} PDF{selectedFiles.length>1?'s':''} · {selectedFiles.reduce((a,f)=>a+f.size,0)>200000000?<span style={{color:T.red}}>⚠️ Puede superar el límite</span>:`${(selectedFiles.reduce((a,f)=>a+f.size,0)/1024/1024).toFixed(1)} MB total`}</div>}
              <button onClick={()=>fileRef.current?.click()} style={{marginTop:6,fontSize:10,background:'none',border:`1px solid ${T.border2}`,borderRadius:5,padding:'3px 9px',cursor:'pointer',color:T.muted,fontFamily:FONT}}>+ Añadir otro PDF</button>
            </div>
          )}
          {pdfFile&&(
            <div style={{background:T.blueS,border:'1px solid #b0d0e0',borderLeft:`3px solid ${T.blue}`,borderRadius:8,padding:'10px 14px',marginBottom:10,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:18}}>📄</span><div><div style={{fontSize:13,color:T.blue,fontWeight:600}}>{pdfName}</div><div style={{fontSize:11,color:T.muted}}>PDF subido manualmente (anula el adjunto del tema)</div></div></div>
              <button onClick={removePdf} style={{background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:20,lineHeight:1}}>×</button>
            </div>
          )}
          {!usingAttachedPdf&&!pdfFile&&(
            <div onClick={()=>fileRef.current?.click()} style={{border:`2px dashed ${T.border2}`,borderRadius:8,padding:'14px',textAlign:'center',cursor:'pointer',marginBottom:14,background:T.card,transition:'all 0.15s'}} onMouseEnter={e=>{e.currentTarget.style.borderColor=T.blue;e.currentTarget.style.background=T.blueS;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border2;e.currentTarget.style.background=T.card;}}>
              <div style={{fontSize:22,marginBottom:4}}>📄</div>
              <div style={{color:T.muted,fontSize:13,fontWeight:500}}>Subir capítulo PDF manualmente</div>
              <div style={{color:T.dim,fontSize:11,marginTop:2}}>O adjunta PDFs permanentes a cada tema desde el Temario · Máx. 80 MB</div>
            </div>
          )}
          <input ref={fileRef} type="file" accept=".pdf" onChange={handlePdfSelect} style={{display:'none'}}/>

          <Lbl>Tipo de pregunta</Lbl>
          <RadioGroup value={aiType} onChange={setAiType} options={[{value:'test',label:'🧪 Test OPE (4 opciones + explicación)'},{value:'flashcard',label:'🃏 Flashcard (concepto / respuesta)'}]}/>
          <Lbl>Cantidad</Lbl>
          <div style={{display:'flex',gap:8,marginBottom:10,flexWrap:'wrap',alignItems:'center'}}>
            {[10,20,50,100].map(n=><button key={n} onClick={()=>setAiN(n)} style={{padding:'7px 14px',borderRadius:7,fontWeight:600,fontSize:13,cursor:'pointer',background:aiN===n?T.teal:T.surface,border:`1px solid ${aiN===n?T.teal:T.border}`,color:aiN===n?'#fff':T.muted,boxShadow:sh.sm,fontFamily:FONT}}>{n}</button>)}
            <div style={{display:'flex',alignItems:'center',gap:6,marginLeft:4}}>
              <input
                type="number" min="1" max="1000" value={aiN}
                onChange={e=>{const v=Math.min(1000,Math.max(1,parseInt(e.target.value)||1));setAiN(v);}}
                style={{width:70,background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:7,padding:'7px 10px',fontSize:13,outline:'none',fontFamily:FONT,textAlign:'center'}}
              />
              <span style={{fontSize:11,color:T.dim}}>máx. 1000</span>
            </div>
          </div>
          {aiN>10&&(()=>{
            const batches=Math.ceil(aiN/10);
            const minsTier1=Math.round(batches*15/60);
            const minsTier2=Math.round(batches*5/60);
            return(
              <div style={{fontSize:11,color:T.muted,marginBottom:14,padding:'8px 12px',background:T.card,borderRadius:6,border:`1px solid ${T.border}`,lineHeight:1.6}}>
                ⏱ <strong>{batches} lotes</strong> de 10 preguntas
                <span style={{color:T.dim}}> · Tier 1: ~{minsTier1} min · Tier 2: ~{minsTier2} min</span>
                {aiN>=100&&<div style={{color:T.amber,marginTop:3}}>💡 Puedes dejar la app en segundo plano — guarda automáticamente cada lote completado.</div>}
              </div>
            );
          })()}
          {batchProgress&&(
            <div style={{marginBottom:14,background:T.card,borderRadius:8,padding:'12px 14px',border:`1px solid ${T.border}`}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:T.muted,marginBottom:6}}>
                <span>Lote <strong style={{color:T.text}}>{batchProgress.done+1}</strong> de {batchProgress.total}</span>
                <span style={{fontWeight:600,color:T.teal}}>{Math.round(batchProgress.done/batchProgress.total*100)}% · {batchProgress.done*10} preguntas guardadas</span>
              </div>
              <div style={{background:T.border,borderRadius:4,height:8,overflow:'hidden'}}>
                <div style={{background:`linear-gradient(90deg,${T.teal},${T.green})`,width:`${Math.round(batchProgress.done/batchProgress.total*100)}%`,height:'100%',borderRadius:4,transition:'width 0.5s'}}/>
              </div>
              {batchProgress.total>5&&<div style={{fontSize:10,color:T.dim,marginTop:5}}>No cierres esta pestaña · Las preguntas se guardan lote a lote</div>}
            </div>
          )}
          <Btn onClick={generateAI} disabled={aiLoading} variant="teal">
            {aiLoading?'⏳ Generando...':effectivePdfLabel?`📄 Generar desde ${effectivePdfLabel}`:'✨ Generar con IA (Tietz/Henry)'}
          </Btn>
          {aiMsg&&<div style={{marginTop:12,padding:'10px 14px',borderRadius:8,fontSize:13,lineHeight:1.5,background:aiMsg.startsWith('✅')?T.greenS:aiMsg.startsWith('❌')?T.redS:T.card,color:aiMsg.startsWith('✅')?T.greenText:aiMsg.startsWith('❌')?T.redText:T.muted,border:`1px solid ${aiMsg.startsWith('✅')?'#b0d8c0':aiMsg.startsWith('❌')?'#e0b8b0':T.border}`,borderLeft:`3px solid ${aiMsg.startsWith('✅')?T.green:aiMsg.startsWith('❌')?T.red:T.border2}`}}>{aiMsg}</div>}
        </div>
      )}

      {subTab==='list'&&(
        <div>
          <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
            <select value={fSection} onChange={e=>setFSection(e.target.value)} style={{background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:7,padding:'7px 12px',fontSize:12,fontFamily:FONT,boxShadow:sh.sm}}>
              <option value="all">Todos los bloques</option>{SECTIONS.map(s=><option key={s.id} value={s.id}>{s.emoji} {s.name}</option>)}
            </select>
            <select value={fType} onChange={e=>setFType(e.target.value)} style={{background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:7,padding:'7px 12px',fontSize:12,fontFamily:FONT,boxShadow:sh.sm}}>
              <option value="all">Test + Flashcards</option><option value="test">Solo test</option><option value="flashcard">Solo flashcards</option>
            </select>
            <span style={{color:T.dim,fontSize:12,marginLeft:'auto'}}>{filtered.length} mostradas</span>
            {qs.length>0&&<><button onClick={exportJSON} style={{background:T.blueS,color:T.blue,border:'1px solid #b0d0e0',borderRadius:7,padding:'6px 12px',fontSize:12,cursor:'pointer',fontFamily:FONT,fontWeight:600}}>⬇️ Exportar JSON</button><button onClick={async()=>{if(confirm(`¿Borrar TODAS las ${qs.length} preguntas?`)){await idbClearQs();setQs([]);}}} style={{background:T.redS,color:T.red,border:'1px solid #e0b8b0',borderRadius:7,padding:'6px 12px',fontSize:12,cursor:'pointer',fontFamily:FONT}}>🗑 Borrar todo</button></>}
          </div>
          {filtered.length===0?<Card style={{padding:'50px',textAlign:'center'}}><div style={{fontSize:36,marginBottom:8}}>📭</div><div style={{color:T.dim}}>{qs.length===0?'Sin preguntas. Genera preguntas con IA.':'Sin preguntas para este filtro.'}</div></Card>:<div style={{display:'flex',flexDirection:'column',gap:8}}>
            {filtered.map(q=><Card key={q.id} style={{padding:'10px 14px',display:'flex',gap:12,borderLeft:`3px solid ${q.type==='test'?T.blue:T.teal}`}}>
              <div style={{flex:1}}>
                <div style={{display:'flex',gap:6,marginBottom:6,flexWrap:'wrap'}}>
                  <span style={{fontSize:10,background:q.type==='test'?T.blueS:T.tealS,color:q.type==='test'?T.blueText:T.tealText,padding:'2px 8px',borderRadius:20,fontWeight:600}}>{q.type==='test'?'Test OPE':'Flashcard'}</span>
                  <span style={{fontSize:10,background:T.card,color:T.muted,padding:'2px 8px',borderRadius:20,border:`1px solid ${T.border}`}}>{q.topic}</span>
                </div>
                <p style={{margin:0,fontSize:13,color:T.text,lineHeight:1.5}}>{q.type==='test'?q.question:(q.front||q.question)}</p>
              </div>
              <button onClick={async()=>{if(confirm('¿Eliminar?'))await saveQs(qs.filter(x=>x.id!==q.id));}} style={{background:'none',border:'none',cursor:'pointer',color:T.dim,fontSize:18,lineHeight:1,padding:0,flexShrink:0}}>×</button>
            </Card>)}
          </div>}
        </div>
      )}

      {subTab==='exam'&&(
        <ExamPdfImporter qs={qs} saveQs={saveQs} apiKey={apiKey}/>
      )}

      {subTab==='upload'&&(
        <div style={{maxWidth:'100%'}}>
          <h3 style={{color:T.text,fontSize:16,fontWeight:600,marginBottom:4}}>📤 Importar preguntas JSON</h3>
          <p style={{color:T.muted,fontSize:13,marginTop:0,marginBottom:12}}>Usa los campos "topic" del temario SESCAM para estadísticas correctas. Acepta mezcla de test y flashcard.</p>
          <textarea value={upText} onChange={e=>setUpText(e.target.value)} placeholder={'[\n  {"topic":"T15. Equilibrio ácido-base...","type":"test","question":"...","options":["A","B","C","D"],"correct":0,"explanation":"..."}\n]'} style={{width:'100%',minHeight:140,background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:8,padding:12,fontSize:12,fontFamily:'monospace',boxSizing:'border-box',resize:'vertical',outline:'none',boxShadow:sh.sm}}/>
          <div style={{marginTop:10,display:'flex',gap:10,alignItems:'center'}}>
            <Btn onClick={importJSON} disabled={!upText.trim()}>Importar</Btn>
            {upMsg&&<span style={{fontSize:13,color:upMsg.startsWith('✅')?T.green:T.red}}>{upMsg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PLANIFICADOR
// ═══════════════════════════════════════════════════════════════════════════
function Planificador({stats,examDate,setExamDate,goToBank}){
  const daysLeft=useMemo(()=>examDate?Math.max(0,Math.ceil((new Date(examDate).setHours(23,59,59)-Date.now())/86400000)):null,[examDate]);

  const topicStatus=useMemo(()=>{
    const m={};ALL_TOPICS.forEach(t=>{m[t]=getStatus(t,stats);});return m;
  },[stats]);

  const counts=useMemo(()=>{
    const c={sinEmpezar:0,necesitaTrabajo:0,enProgreso:0,dominado:0};
    Object.values(topicStatus).forEach(s=>c[s]++);return c;
  },[topicStatus]);

  const prioritized=useMemo(()=>[...ALL_TOPICS].sort((a,b)=>STATUS_ORDER[topicStatus[a]]-STATUS_ORDER[topicStatus[b]]),[topicStatus]);
  const todaySuggestions=useMemo(()=>prioritized.filter(t=>topicStatus[t]!=='dominado').slice(0,5),[prioritized,topicStatus]);

  const statusItems=[
    {key:'sinEmpezar',  label:'Sin empezar',    icon:'⬜'},
    {key:'necesitaTrabajo',label:'Necesita trabajo',icon:'🔴'},
    {key:'enProgreso',  label:'En progreso',    icon:'🟡'},
    {key:'dominado',    label:'Dominado (≥75%)',icon:'✅'},
  ];

  return(
    <div>
      <h2 style={{fontSize:18,fontWeight:700,margin:'0 0 4px',color:T.text,letterSpacing:-0.3}}>📅 Planificador de estudio</h2>
      <p style={{color:T.muted,fontSize:13,margin:'0 0 24px'}}>Organiza el estudio de los 60 temas de la OPE SESCAM según tu disponibilidad.</p>

      {/* Exam date */}
      <Card style={{padding:'18px 22px',marginBottom:20}}>
        <div style={{display:'flex',alignItems:'center',gap:20,flexWrap:'wrap'}}>
          <div style={{flex:1}}>
            <Lbl>Fecha del examen</Lbl>
            <input type="date" value={examDate} onChange={e=>setExamDate(e.target.value)}
              style={{background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:7,padding:'9px 12px',fontSize:13,outline:'none',fontFamily:FONT,boxShadow:sh.sm,width:'100%',maxWidth:220,boxSizing:'border-box'}}
            />
            {!examDate&&<p style={{color:T.muted,fontSize:12,marginTop:6,marginBottom:0}}>Introduce la fecha del examen para ver cuánto tiempo queda y planificar mejor.</p>}
          </div>
          {daysLeft!==null&&(
            <div style={{textAlign:'center',background:daysLeft<30?T.redS:daysLeft<90?T.amberS:T.blueS,border:`1px solid ${daysLeft<30?'#e0b8b0':daysLeft<90?'#d4b44a':'#b0d0e0'}`,borderRadius:12,padding:'16px 24px'}}>
              <div style={{fontSize:48,fontWeight:800,color:daysLeft<30?T.red:daysLeft<90?T.amber:T.blue,lineHeight:1,letterSpacing:-2}}>{daysLeft}</div>
              <div style={{fontSize:12,color:T.muted,marginTop:4}}>días para la OPE</div>
              {daysLeft>0&&<div style={{fontSize:11,color:T.dim,marginTop:2}}>~{Math.round(daysLeft/7)} semanas</div>}
            </div>
          )}
        </div>
      </Card>

      {/* Status overview */}
      <Card style={{padding:'18px 22px',marginBottom:20}}>
        <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:14,display:'flex',alignItems:'center',gap:8}}><span style={{width:3,height:16,background:T.blue,borderRadius:2,display:'block'}}/>Estado del temario ({ALL_TOPICS.length} temas)</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10,marginBottom:14}}>
          {statusItems.map(s=><div key={s.key} style={{background:STATUS_BG[s.key],border:`1px solid ${STATUS_COLORS[s.key]}30`,borderRadius:8,padding:'12px',textAlign:'center'}}>
            <div style={{fontSize:20,marginBottom:4}}>{s.icon}</div>
            <div style={{fontSize:22,fontWeight:700,color:STATUS_COLORS[s.key]}}>{counts[s.key]}</div>
            <div style={{fontSize:11,color:T.muted}}>{s.label}</div>
          </div>)}
        </div>
        <div style={{background:T.border,borderRadius:4,height:8,overflow:'hidden',display:'flex'}}>
          {statusItems.map(s=><div key={s.key} style={{flex:counts[s.key],background:STATUS_COLORS[s.key],transition:'flex 0.5s',minWidth:counts[s.key]>0?2:0}}/>)}
        </div>
        <div style={{fontSize:11,color:T.muted,marginTop:6,textAlign:'right'}}>
          {Math.round(counts.dominado/ALL_TOPICS.length*100)}% dominado · {Math.round((counts.dominado+counts.enProgreso)/ALL_TOPICS.length*100)}% con algún avance
        </div>
      </Card>

      {/* Today suggestions */}
      {todaySuggestions.length>0&&(
        <Card style={{padding:'18px 22px',marginBottom:20}}>
          <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:4,display:'flex',alignItems:'center',gap:8}}><span style={{width:3,height:16,background:T.orange,borderRadius:2,display:'block'}}/>Estudia hoy</div>
          <p style={{color:T.muted,fontSize:12,marginTop:0,marginBottom:14}}>Temas prioritarios ordenados por necesidad. Los primeros son los que más impactan tu nota.</p>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {todaySuggestions.map((t,i)=>{
              const st=topicStatus[t];const sec=SECTIONS.find(s=>s.topics.includes(t));const ts=stats[t];
              return <div key={t} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',background:T.card,border:`1px solid ${T.border}`,borderRadius:8}}>
                <div style={{width:24,height:24,borderRadius:'50%',background:STATUS_BG[st],border:`1.5px solid ${STATUS_COLORS[st]}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:STATUS_COLORS[st],flexShrink:0}}>{i+1}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,color:T.text,fontWeight:500,lineHeight:1.4}}>{t}</div>
                  <div style={{display:'flex',gap:8,marginTop:3,alignItems:'center'}}>
                    <span style={{fontSize:10,background:STATUS_BG[st],color:STATUS_COLORS[st],padding:'1px 7px',borderRadius:20,fontWeight:600}}>{STATUS_LABELS[st]}</span>
                    {ts&&<span style={{fontSize:10,color:T.dim}}>{ts.c}/{ts.t} correctas ({Math.round(ts.c/ts.t*100)}%)</span>}
                    {sec&&<span style={{fontSize:10,color:sec.color}}>{sec.emoji} {sec.name}</span>}
                  </div>
                </div>
                <button onClick={()=>goToBank(sec?.id||'all',t)} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:7,padding:'6px 12px',fontSize:11,fontWeight:600,cursor:'pointer',color:T.blue,fontFamily:FONT,flexShrink:0,boxShadow:sh.sm}}>✨ Generar preguntas</button>
              </div>;
            })}
          </div>
        </Card>
      )}

      {/* Full topic list */}
      <Card style={{padding:'18px 22px'}}>
        <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:14,display:'flex',alignItems:'center',gap:8}}><span style={{width:3,height:16,background:T.green,borderRadius:2,display:'block'}}/>Todos los temas ordenados por prioridad</div>
        <div style={{display:'flex',flexDirection:'column',gap:5}}>
          {prioritized.map(t=>{
            const st=topicStatus[t];const ts=stats[t];const sec=SECTIONS.find(s=>s.topics.includes(t));
            return <div key={t} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:7,background:T.card,border:`1px solid ${T.border}`}}>
              <span style={{width:8,height:8,borderRadius:'50%',background:STATUS_COLORS[st],flexShrink:0}}/>
              <span style={{fontSize:12,color:T.text,flex:1,lineHeight:1.3}}>{t}</span>
              {ts?<span style={{fontSize:11,fontWeight:600,color:ts.c/ts.t>=0.75?T.green:ts.c/ts.t>=0.5?T.amber:T.red,flexShrink:0}}>{Math.round(ts.c/ts.t*100)}%</span>:<span style={{fontSize:10,color:T.dim,flexShrink:0,background:STATUS_BG[st],padding:'1px 6px',borderRadius:10}}>{STATUS_LABELS[st]}</span>}
              <button onClick={()=>goToBank(sec?.id||'all',t)} style={{background:'none',border:`1px solid ${T.border}`,borderRadius:5,padding:'3px 8px',fontSize:10,cursor:'pointer',color:T.blue,fontFamily:FONT,flexShrink:0}}>✨</button>
            </div>;
          })}
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STATS VIEW — con historial de sesiones
// ═══════════════════════════════════════════════════════════════════════════
function StatsView({stats,qs,errSet,marked,sr,sessions}){
  const totalA=Object.values(stats).reduce((a,b)=>a+b.t,0);
  const totalC=Object.values(stats).reduce((a,b)=>a+b.c,0);
  const acc=totalA?Math.round(totalC/totalA*100):0;
  const fcQs=qs.filter(q=>q.type==='flashcard');
  const learned=fcQs.filter(q=>(sr[q.id]?.reps||0)>=3).length;
  const studied=ALL_TOPICS.filter(t=>stats[t]?.t>0).length;
  const dominated=ALL_TOPICS.filter(t=>getStatus(t,stats)==='dominado').length;

  return(
    <div>
      <h2 style={{fontSize:18,fontWeight:700,marginBottom:20,color:T.text,letterSpacing:-0.3}}>📈 Estadísticas de progreso</h2>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:12,marginBottom:28}}>
        {[{l:'Respondidas',v:totalA,c:T.blue,i:'📝'},{l:'Acierto global',v:`${acc}%`,c:acc>=70?T.green:acc>=50?T.amber:T.red,i:'🎯'},{l:'Temas estudiados',v:`${studied}/${ALL_TOPICS.length}`,c:T.teal,i:'📋'},{l:'Temas dominados',v:dominated,c:T.green,i:'🏆'},{l:'FC aprendidas',v:`${learned}/${fcQs.length}`,c:T.purple,i:'🧠'},{l:'En error',v:errSet.size,c:T.red,i:'❌'}].map(s=>(
          <Card key={s.l} style={{padding:'16px'}}>
            <div style={{width:32,height:32,borderRadius:8,background:s.c+'18',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,marginBottom:10}}>{s.i}</div>
            <div style={{fontSize:22,fontWeight:700,color:s.c,lineHeight:1}}>{s.v}</div>
            <div style={{fontSize:12,color:T.muted,marginTop:4}}>{s.l}</div>
          </Card>
        ))}
      </div>

      {/* Session history */}
      {sessions.length>0&&(
        <Card style={{padding:'18px 22px',marginBottom:20}}>
          <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:14,display:'flex',alignItems:'center',gap:8}}><span style={{width:3,height:16,background:T.orange,borderRadius:2,display:'block'}}/>Historial de sesiones ({sessions.length})</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {sessions.slice(0,15).map(s=>{
              const modeColor={test:T.blue,simulacro:T.orange,flashcard:T.teal}[s.mode]||T.muted;
              const modeLabel={test:'Test OPE',simulacro:'Simulacro ⚡',flashcard:'Flashcards'}[s.mode]||s.mode;
              const dur=s.duration?Math.round(s.duration/60)+'min':null;
              return <div key={s.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',background:T.card,borderRadius:8,border:`1px solid ${T.border}`}}>
                <span style={{background:modeColor+'18',color:modeColor,padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:600,flexShrink:0,minWidth:80,textAlign:'center'}}>{modeLabel}</span>
                <span style={{fontSize:12,color:T.muted,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.topics?.slice(0,2).join(', ')||'—'}{s.topics?.length>2?` +${s.topics.length-2}`:''}</span>
                <span style={{fontSize:12,color:T.dim,flexShrink:0}}>{s.n} preg.</span>
                {dur&&<span style={{fontSize:11,color:T.dim,flexShrink:0}}>{dur}</span>}
                <span style={{fontSize:13,fontWeight:700,color:s.pct>=70?T.green:s.pct>=50?T.amber:T.red,flexShrink:0,minWidth:38,textAlign:'right'}}>{s.pct}%</span>
                <span style={{fontSize:11,color:T.dim,flexShrink:0}}>{fmtDate(s.date)}</span>
              </div>;
            })}
          </div>
        </Card>
      )}

      {/* Per section */}
      {Object.keys(stats).length===0?<Card style={{padding:'50px',textAlign:'center'}}><div style={{fontSize:36,marginBottom:8}}>📊</div><div style={{color:T.dim}}>Responde preguntas para ver tu progreso.</div></Card>:SECTIONS.map(s=>{
        const ss=Object.entries(stats).filter(([t])=>s.topics.includes(t));if(!ss.length)return null;
        const tot=ss.reduce((a,[,v])=>a+v.t,0);const cor=ss.reduce((a,[,v])=>a+v.c,0);const pct=Math.round(cor/tot*100);
        return <Card key={s.id} style={{padding:'16px 20px',marginBottom:12}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <div style={{width:28,height:28,borderRadius:6,background:s.colorS,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}>{s.emoji}</div>
              <span style={{fontSize:14,fontWeight:600,color:T.text}}>{s.name}</span>
            </div>
            <span style={{fontWeight:700,color:pct>=70?T.green:pct>=50?T.amber:T.red,fontSize:14}}>{pct}%</span>
          </div>
          <PBar pct={pct} color={s.color}/>
          <div style={{display:'flex',flexDirection:'column',gap:5,marginTop:10}}>
            {ss.map(([topic,sv])=>{const tp=Math.round(sv.c/sv.t*100);return <div key={topic} style={{display:'flex',alignItems:'center',gap:8,paddingLeft:10}}>
              <span style={{width:4,height:4,borderRadius:'50%',background:STATUS_COLORS[getStatus(topic,stats)],flexShrink:0}}/>
              <span style={{fontSize:12,color:T.muted,flex:1}}>{topic}</span>
              <span style={{fontSize:11,color:T.dim}}>{sv.c}/{sv.t}</span>
              <span style={{fontSize:12,fontWeight:600,color:tp>=70?T.green:tp>=50?T.amber:T.red,minWidth:30,textAlign:'right'}}>{tp}%</span>
            </div>;})}
          </div>
        </Card>;
      })}
    </div>
  );
}
