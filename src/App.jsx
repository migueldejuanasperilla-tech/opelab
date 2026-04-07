import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { PDFDocument } from "pdf-lib";

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
const topicPdfKey=t=>'pdf_'+t.replace(/[^a-zA-Z0-9]/g,'').slice(0,40);
// Clave por archivo individual en IndexedDB
const topicFilePdfKey=(t,id)=>topicPdfKey(t)+'_'+id;
// Convertir Blob/File a base64 para la API
const blobToB64=blob=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.onerror=rej;r.readAsDataURL(blob);});

// ── Merge PDFs respetando el límite de 90 páginas de la API ──────────────────
const MAX_TOTAL_PAGES=10;
async function mergePdfsWithLimit(blobs){
  const merged=await PDFDocument.create();
  let total=0;
  for(const blob of blobs){
    if(total>=MAX_TOTAL_PAGES)break;
    try{
      const buf=await blob.arrayBuffer();
      const src=await PDFDocument.load(buf,{ignoreEncryption:true});
      const available=Math.min(src.getPageCount(),MAX_TOTAL_PAGES-total);
      if(available<=0)break;
      const indices=Array.from({length:available},(_,i)=>i);
      const pages=await merged.copyPages(src,indices);
      pages.forEach(p=>merged.addPage(p));
      total+=available;
    }catch(e){console.warn('Error merging PDF:',e);}
  }
  const bytes=await merged.save();
  return{file:new File([bytes],'merged.pdf',{type:'application/pdf'}),pages:total};
}
const CHUNK_PAGES=30;
async function splitPdfIfNeeded(file){
  const buf=await file.arrayBuffer();
  const src=await PDFDocument.load(buf,{ignoreEncryption:true});
  const total=src.getPageCount();
  if(total<=CHUNK_PAGES) return [{file,name:file.name,pages:`1–${total}`,total}];
  const chunks=[];
  for(let s=0;s<total;s+=CHUNK_PAGES){
    const e=Math.min(s+CHUNK_PAGES,total);
    const doc=await PDFDocument.create();
    const indices=Array.from({length:e-s},(_,i)=>s+i);
    const copied=await doc.copyPages(src,indices);
    copied.forEach(p=>doc.addPage(p));
    const bytes=await doc.save();
    const blob=new Blob([bytes],{type:'application/pdf'});
    const base=file.name.replace(/\.pdf$/i,'');
    const name=`${base}_p${s+1}-${e}.pdf`;
    chunks.push({file:new File([blob],name,{type:'application/pdf'}),name,pages:`${s+1}–${e}`,total:e-s});
  }
  return chunks;
}

// ── Theme ────────────────────────────────────────────────────────────────────
const T={
  bg:'#f4f9f7',surface:'#ffffff',card:'#ffffff',
  border:'#e0eeea',border2:'#c8e0d8',
  text:'#1b3a30',muted:'#68a090',dim:'#a8c8be',
  blue:'#2055b8',blueDk:'#174494',blueS:'#eaf2fc',blueText:'#174494',
  green:'#05b490',greenDk:'#048a6e',greenS:'#e6faf5',greenText:'#035c4a',
  teal:'#0891b2',tealDk:'#0678a0',tealS:'#e0f4fa',tealText:'#054f68',
  amber:'#c47d0a',amberS:'#fef6e4',amberText:'#7a4d06',
  red:'#e53e3e',redDk:'#c53030',redS:'#fff5f5',redText:'#742a2a',
  purple:'#6b34d4',purpleDk:'#5828aa',purpleS:'#f2eeff',purpleText:'#3d1d82',
  orange:'#d45010',orangeS:'#fdf3ec',orangeText:'#7a2e08',
};
const FONT="'DM Sans',system-ui,sans-serif";
const sh={
  sm:'0 1px 4px rgba(0,50,30,.06),0 1px 2px rgba(0,50,30,.04)',
  md:'0 4px 24px rgba(0,50,30,.08),0 2px 8px rgba(0,50,30,.04)',
  lg:'0 8px 40px rgba(0,50,30,.10)',
};

// ── Sections ─────────────────────────────────────────────────────────────────
const SECTIONS=[
  {id:'comun',name:'Temario Común y Legislación',emoji:'⚖️',color:'#5a8a7a',colorS:'#edf6f2',colorBorder:'#aed0c4',desc:'Constitución, autonomía CLM, leyes sanitarias, SESCAM, legislación laboral y ética',tietz:'—',henry:'—',temas:[1,2,3,4,5,6],
   topics:['T1. Constitución Española: derechos fundamentales y protección de la salud','T1. Estatuto de Autonomía CLM: instituciones y competencias de la Junta. Igualdad y violencia de género','T2. Ley General de Sanidad: organización del SNS, áreas de salud, CCAA','T2. SESCAM: funciones, organización y estructura. Ley de Ordenación Sanitaria CLM','T3. Ley de cohesión y calidad del SNS: prestaciones, garantías, Consejo Interterritorial','T4. Estatuto Marco del personal estatutario. Ley de Prevención de Riesgos Laborales','T5. Ley de derechos y deberes en salud CLM. Documentación sanitaria (Decreto 24/2011)','T6. Plan Dignifica SESCAM: humanización de la asistencia. Estratificación de crónicos']},
  {id:'fundamentos',name:'Fundamentos del Laboratorio',emoji:'🏛️',color:T.blue,colorS:T.blueS,colorBorder:'#93c5fd',desc:'Preanalítica, control de calidad, postanalítica, estadística, gestión, ISO 15189, SIL, instrumentación',tietz:'Secc. I–II caps. 1–9, 16–30',henry:'Parte 1 caps. 1–14',temas:[7,8,9,10,11,12,13,14],
   topics:['T7. Fase preanalítica: obtención, transporte, conservación y criterios de rechazo de muestras','T8. Control de calidad analítico: CCI, PECS/EQA, reglas de Westgard, Seis Sigma, variabilidad biológica','T9. Fase postanalítica: informe del laboratorio, valores de referencia, valores críticos, valor del cambio','T10. Bioestadística: descriptiva, inferencial, correlación, evaluación de pruebas diagnósticas (Se/Sp/VPP/VPN)','T11. Gestión del laboratorio clínico: gestión por procesos, RRHH, indicadores, cuadros de mando','T12. Modelos de gestión de calidad: ISO 15189, Joint Commission, EFQM. Bioética, protección de datos','T13. SIL, inteligencia artificial, Big Data y ciberseguridad en el laboratorio clínico','T14. Principios metodológicos: espectrofotometría, electroforesis, cromatografía, masas, POCT, automatización']},
  {id:'bioquimica',name:'Bioquímica Clínica',emoji:'🧬',color:'#6b34d4',colorS:'#f2eeff',colorBorder:'#c4aff0',desc:'Gases, riñón, mineral, glucosa, lípidos, proteínas, hígado, corazón, inflamación, endocrinología, fármacos',tietz:'Secc. III–IV caps. 31–51',henry:'Parte 2 caps. 15–28',temas:[15,16,17,18,19,20,21,22,23,24,25,26,27],
   topics:['T15. Equilibrio ácido-base y gases sanguíneos: fisiología, gasometría arterial, cooximetría','T16. Función renal y equilibrio hidroelectrolítico: FGe, proteinuria, osmolalidad, patología tubular','T17. Metabolismo mineral: hierro, calcio, magnesio, fósforo, metabolismo óseo y vitamina D','T18. Hidratos de carbono: metabolismo glucídico, diabetes mellitus, HbA1c, insulina, péptido C','T19. Lípidos y lipoproteínas: dislipemias, síndrome metabólico, riesgo cardiovascular','T20. Proteínas plasmáticas: electroforesis, paraproteínas, cadenas ligeras libres, enzimología, porfirias','T21. Función hepatobiliar: marcadores, hepatopatía aguda y crónica, índices de fibrosis, autoinmunidad hepática','T22. Función cardiaca y muscular: troponinas, BNP, síndrome coronario agudo, insuficiencia cardíaca','T23. Marcadores de inflamación y sepsis: PCR, PCT, IL-6, ferritina, dímero D','T24. Función gastrointestinal: páncreas, malabsorción, EII, estudio de heces, sangre oculta','T25. Marcadores tumorales: PSA, AFP, CEA, CA 125, CA 19-9; biopsia líquida, ADN circulante','T26. Función endocrina: hipotálamo-hipófisis, tiroides, paratiroides, suprarrenal, hormonas sexuales','T27. Monitorización de fármacos: farmacocinética, fármacos biológicos, drogas de abuso, intoxicaciones']},
  {id:'liquidos',name:'Orina, Líquidos y Reproducción',emoji:'💧',color:'#0284c7',colorS:'#e0f2fe',colorBorder:'#7dd3fc',desc:'Análisis de orina, líquidos biológicos, seminograma, reproducción asistida y cribado prenatal',tietz:'Cap. 45, 58–59',henry:'Parte 3 caps. 29–30',temas:[28,29,30,31],
   topics:['T28. Estudio de la orina: análisis bioquímico, sedimento urinario, litiasis renal','T29. Líquidos biológicos: ascítico, cefalorraquídeo, pleural, amniótico, pericárdico, sinovial','T30. Líquido seminal: seminograma (criterios OMS), FIV, ICSI, inseminación artificial, donación de gametos','T31. Embarazo: cribado bioquímico de cromosomopatías, DPNI, trastornos hipertensivos del embarazo']},
  {id:'hematologia',name:'Hematología',emoji:'🩸',color:T.red,colorS:T.redS,colorBorder:'#fca5a5',desc:'Hemograma, hematopoyesis, eritrocitos, leucocitos neoplásicos y no neoplásicos, plaquetas',tietz:'Secc. VII caps. 74–78',henry:'Parte 4 caps. 31–35',temas:[32,33,34,35,36,37],
   topics:['T32. Hemograma: principios de automatización, tinción y morfología de frotis sanguíneo, VSG','T33. Hematopoyesis: médula ósea, eritropoyesis, leucopoyesis, trombopoyesis','T34. Patologías eritrocitarias: anemias, hemoglobinopatías, talasemias, poliglobulias','T35. Trastornos leucocitarios no neoplásicos: alteraciones en granulocitos, linfocitos, monocitos, eosinófilos','T36. Trastornos leucocitarios neoplásicos: leucemias, linfomas, mieloma múltiple, SMD, síndromes mieloproliferativos','T37. Trastornos plaquetarios: trombocitopenias, trombocitosis y disfunción plaquetaria']},
  {id:'hemostasia',name:'Hemostasia y Transfusión',emoji:'🔴',color:T.orange,colorS:T.orangeS,colorBorder:'#fdba74',desc:'Coagulación, fibrinólisis, anticoagulación, inmunohematología y medicina transfusional',tietz:'Caps. 79–81, 90–93',henry:'Parte 4–5 caps. 36–43',temas:[38,39],
   topics:['T38. Hemostasia y trombosis: factores de coagulación, TP/TTPA/fibrinógeno, fibrinólisis, anticoagulantes (NACO)','T38. Trombofilia: estudio de trombosis venosa y arterial. Control del tratamiento anticoagulante','T39. Inmunohematología: sistemas ABO y Rh, anticuerpos irregulares, prueba de Coombs, crossmatch','T39. Medicina transfusional: componentes sanguíneos, indicaciones, reacciones adversas, hemovigilancia']},
  {id:'microbiologia',name:'Microbiología',emoji:'🦠',color:T.green,colorS:T.greenS,colorBorder:'#86efac',desc:'Bacteriología, micobacterias, hongos, parásitos, virus, serología y patologías infecciosas',tietz:'Secc. VIII caps. 82–89',henry:'Parte 7 caps. 57–66',temas:[40,41,42,43,44,45,46,47,48,49,50],
   topics:['T40. Muestras microbiológicas: obtención, procesamiento, medios de cultivo, tinciones','T41. Identificación microbiológica: antibiograma (EUCAST/CLSI), mecanismos de resistencia, MALDI-TOF','T42. Bacterias aerobias de interés clínico: Gram positivos y Gram negativos','T43. Bacterias anaerobias: Clostridium, Bacteroides, Actinomyces, diagnóstico y clínica','T44. Micobacterias: M. tuberculosis, NTM, Ziehl-Neelsen, MGIT 960, IGRA, PCR, tratamiento','T45. Otros microorganismos: micoplasmas, espiroquetas, clamidias, rickettsias, enfermedades emergentes','T46. Micología: levaduras (Candida, Cryptococcus), hongos filamentosos (Aspergillus), antifúngicos','T47. Parasitología: técnicas de diagnóstico, parásitos de interés clínico, tratamiento antiparasitario','T48. Virología: VIH, hepatitis A/B/C, virus respiratorios, PCR en tiempo real, priones','T49. Diagnóstico serológico: detección de antígenos y anticuerpos, pruebas de cribado y confirmación','T50. Patologías infecciosas: sepsis, infecciones nosocomiales, meningitis, ITS, paciente inmunodeprimido']},
  {id:'molecular',name:'Biología Molecular y Genética',emoji:'🧪',color:T.teal,colorS:T.tealS,colorBorder:'#70c0d8',desc:'Genética humana, citogenética, farmacogenómica y biología molecular diagnóstica',tietz:'Secc. VI caps. 62–73',henry:'Parte 8 caps. 67–75',temas:[51,52,53,54],
   topics:['T51. Genética humana: mutaciones, patrones de herencia, árboles genealógicos','T52. Citogenética: cariotipo, anomalías cromosómicas estructurales y numéricas, diagnóstico prenatal y preimplantacional','T53. Genética aplicada: farmacogenética, cribado poblacional, bases moleculares del cáncer, medicina de precisión','T54. Biología molecular diagnóstica: PCR, NGS, hibridación, array-CGH, exomas, biopsia líquida']},
  {id:'inmunologia',name:'Inmunología',emoji:'🛡️',color:'#0d9488',colorS:'#ccfbf1',colorBorder:'#5eead4',desc:'Sistema inmune, HLA y trasplante, alergias, autoinmunidad sistémica y de órgano, inmunodeficiencias',tietz:'Secc. X caps. 94–100',henry:'Parte 6 caps. 44–56',temas:[55,56,57,58,59,60],
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
function buildStudyPrompt(topic, hasPdf=false){
  const refs=TOPIC_REFS[topic];
  const refsStr=refs&&refs.tietz!=='—'?`Capítulos de referencia: Tietz ${refs.tietz} · Henry ${refs.henry}.`:'';

  const source=hasPdf
    ?`Tienes delante el capítulo correspondiente del Tietz y/o Henry. Trabaja EXCLUSIVAMENTE con el contenido del documento adjunto — extrae los subapartados, párrafos y conceptos tal y como aparecen en el texto original. No añadas conocimiento externo.`
    :`Actúa como si tuvieras delante los capítulos correspondientes del Tietz Textbook of Laboratory Medicine, 7ª ed. (Rifai et al., 2022) y del Henry El Laboratorio en el Diagnóstico Clínico, 23ª ed. (McPherson & Pincus, 2022). ${refsStr} Reproduce fielmente el nivel de detalle y rigor técnico de esos libros.`;

  return `Eres un experto en bioquímica clínica y preparación de oposiciones FEA Laboratorio Clínico (SESCAM 2025). Tu misión es analizar en profundidad el siguiente tema y generar un resumen de estudio altamente estructurado y conceptual:

TEMA: "${topic}"

FUENTE: ${source}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROCESO DE ANÁLISIS — sigue estos pasos en orden
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PASO 1 — IDENTIFICAR SUBAPARTADOS
Identifica los subapartados o secciones naturales del capítulo (como aparecen en el libro o como los estructuraría un experto). Por ejemplo: Fisiología/Bioquímica, Métodos analíticos, Valores de referencia, Interpretación clínica, Patologías asociadas, Interferencias, Diagnóstico diferencial, etc. El número de subapartados debe reflejar la complejidad real del tema (mínimo 4, máximo 10).

PASO 2 — EXTRAER CONCEPTOS DE CADA SUBAPARTADO
Para cada subapartado, identifica TODOS los conceptos individuales relevantes que contiene. Un concepto es una unidad de información concreta: un mecanismo, un valor numérico, una clasificación, una técnica, una relación causa-efecto, una excepción, un dato clínico. No agrupes conceptos distintos en uno solo.

PASO 3 — GENERAR EXPLICACIÓN DE CADA CONCEPTO
Para cada concepto, genera una explicación propia que:
• Empiece por el dato o idea central (el "qué")
• Explique el mecanismo o razonamiento subyacente (el "por qué")
• Indique la consecuencia clínica o analítica (el "para qué sirve saber esto")
• Incluya el valor numérico exacto, nombre de proteína/enzima/gen, o criterio diagnóstico cuando exista
• Tenga entre 2 y 4 frases — concisa pero completa
• Use lenguaje técnico de especialista FEA, no divulgativo

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ESTÁNDARES DE CALIDAD INAMOVIBLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Cada explicación debe contener al menos un dato concreto (número, nombre técnico, gen, enzima, porcentaje, tiempo)
✓ Nivel 8-9/10: datos que distinguen al opositor que estudió en profundidad del que solo repasó
✓ Español médico correcto; nombres de enzimas y proteínas en español con acrónimo entre paréntesis
✓ Mínimo 5 conceptos por subapartado
✓ Las explicaciones deben ser originales — no copiar frases del libro, sino sintetizar y explicar
✗ PROHIBIDO: frases genéricas ("es importante", "se debe considerar", "varía según el laboratorio")
✗ PROHIBIDO: agrupar dos conceptos distintos en una sola explicación
✗ PROHIBIDO: subapartados vacíos o con menos de 5 conceptos
✗ PROHIBIDO: repetir el mismo concepto en distintos subapartados

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATO DE RESPUESTA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Responde ÚNICAMENTE con el siguiente JSON válido, sin texto previo, sin texto posterior, sin bloques de código markdown, sin backticks. El JSON debe ser parseable directamente con JSON.parse():

{"resumen":"Párrafo introductorio de 3-5 frases que contextualice el tema: qué estudia, qué parámetros analíticos incluye, cuál es su relevancia diagnóstica y qué patologías principales abarca.","subapartados":[{"titulo":"Nombre del subapartado tal como aparece en el libro o lo estructuraría un experto","conceptos":[{"nombre":"Nombre corto del concepto (5-8 palabras máx.)","explicacion":"Explicación completa del concepto: dato central + mecanismo + consecuencia clínica/analítica. Mínimo 2 frases, máximo 5. Incluye el valor numérico exacto o nombre técnico específico."}]}]}`;
}
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

// ── Learning status helpers ─────────────────────────────────────────────────
// Score for a single unit (section or subsection): postTest 40% + flashcards 30% + clinical 30%
// External test data also contributes to the score
function calcUnitScore(unit){
  if(!unit?.generated) return null;
  const prog=unit.generated.progress||{};
  let total=0,parts=0;
  if(prog.postTest?.completed){total+=prog.postTest.score*0.4;parts+=0.4;}
  if(prog.flashcardsDominated!=null&&unit.generated.phases?.flashcards?.length){
    total+=(prog.flashcardsDominated/unit.generated.phases.flashcards.length*100)*0.3;parts+=0.3;
  }
  if(prog.clinicalScore!=null){total+=prog.clinicalScore*0.3;parts+=0.3;}
  // Blend external test performance (from Test/Simulacro) if available
  if(prog.externalTests?.t>=3){
    const extScore=Math.round(prog.externalTests.c/prog.externalTests.t*100);
    if(parts>0){total=total*0.85+extScore*0.15;} // 15% weight for external
    else{total=extScore;parts=1;}
  }
  return parts>0?Math.round(total/parts):null;
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
  // A section counts as "generated" if it or any of its subsections have generated content
  const generated=learning.sections.filter(s=>s.generated||(s.subsections||[]).some(sub=>sub.generated)).length;
  const scores=learning.sections.map(calcSectionScore).filter(s=>s!==null);
  const mastery=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):0;
  const coverage=Math.round(generated/total*100);
  const hasLowSection=scores.some(s=>s<60);
  let status,color,label;
  if(generated===0){status='sinEmpezar';color=T.dim;label='Sin empezar';}
  else if(hasLowSection){status='necesitaTrabajo';color=T.red;label=`${mastery}% dominio`;}
  else if(mastery>=80&&coverage===100){status='dominado';color=T.green;label=`${mastery}% dominio`;}
  else{status='enProgreso';color=T.amber;label=`${mastery}% dominio`;}
  return{coverage,mastery,status,color,label,generated,total};
}

// ═══════════════════════════════════════════════════════════════════════════
export default function App(){
  const [tab,setTab]=useState('dashboard');
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
      setApiKeyState(ak);setStudyNotesState(sn);setLearningData(ld);setLoaded(true);
    })();
  },[]);

  const saveApiKey=useCallback(k=>{setApiKeyState(k);save('olab_api_key',k);},[]);
  const saveStudyNote=useCallback((topic,content)=>{
    setStudyNotesState(prev=>{const n={...prev,[topic]:{content,date:new Date().toISOString()}};save('olab_study_notes',n);return n;});
  },[]);
  const saveLearningData=useCallback(async(topic,data)=>{
    if(data){await idbSaveLearning(topic,data);setLearningData(prev=>({...prev,[topic]:data}));}
    else{await idbDeleteLearning(topic);setLearningData(prev=>{const n={...prev};delete n[topic];return n;});}
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

  // Guardar PDF — divide automáticamente si >80 páginas
  const savePdfForTopic=useCallback(async(topic,file)=>{
    const tKey=topicPdfKey(topic);
    const chunks=await splitPdfIfNeeded(file);
    for(const chunk of chunks){
      const fileId=uid();
      await idbSave(topicFilePdfKey(topic,fileId),chunk.file);
      setPdfMetaState(prev=>{
        const existing=prev[tKey]||[];
        const entry={id:fileId,name:chunk.name,size:chunk.file.size,date:new Date().toISOString(),pages:chunk.pages};
        const n={...prev,[tKey]:[...existing,entry]};
        save('olab_pdf_meta',n);return n;
      });
    }
    return chunks.length; // devuelve nº de trozos creados
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

  const navItems=[
    {id:'panel',label:'Panel'},
    {id:'conocimiento',label:'Conocimiento'},
    {id:'test',label:'Test'},
  ];

  // Normalize legacy tab names
  const normalizedTab=
    tab==='dashboard'||tab==='stats'||tab==='planificador'?'panel':
    tab==='temario'||tab==='estudio'?'conocimiento':
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
      <div style={{padding:'32px 40px'}}>
        <Ajustes apiKey={apiKey} onSave={saveApiKey}/>
      </div>
    </div>
  );

  return(
    <div style={{minHeight:'100vh',background:T.bg,color:T.text,fontFamily:FONT,fontSize:14}}>
      <div style={{background:'rgba(255,255,255,0.85)',backdropFilter:'blur(10px)',borderBottom:`1px solid ${T.border}`,boxShadow:sh.sm,position:'sticky',top:0,zIndex:50}}>
        <div style={{padding:'0 40px'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',paddingTop:14,paddingBottom:6}}>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:36,height:36,borderRadius:12,background:`linear-gradient(135deg,${T.green},${T.teal})`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,boxShadow:sh.sm}}>🔬</div>
              <div><span style={{fontWeight:700,fontSize:16,color:T.text,letterSpacing:'-0.3px'}}>OPE Lab</span><span style={{color:T.muted,fontSize:11,marginLeft:8,fontWeight:400}}>FEA Laboratorio Clínico · SESCAM 2025</span></div>
            </div>
            <div style={{display:'flex',gap:6,alignItems:'center'}}>
              <Chip color={T.blue} bg={T.blueS}>{qs.length} preg.</Chip>
              {dueQs.length>0&&<Chip color={T.amber} bg={T.amberS}>{dueQs.length} pendientes</Chip>}
              {errSet.size>0&&<Chip color={T.red} bg={T.redS}>{errSet.size} errores</Chip>}
              <button onClick={()=>setTab('ajustes')} title="Ajustes" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:'6px 10px',cursor:'pointer',color:T.muted,fontSize:14,lineHeight:1,marginLeft:4,boxShadow:sh.sm}}>⚙️</button>
            </div>
          </div>
          <div style={{display:'flex',marginTop:4,gap:0}}>
            {navItems.map(n=>(
              <button key={n.id} onClick={()=>setTab(n.id)} style={{padding:'9px 16px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:normalizedTab===n.id?700:500,color:normalizedTab===n.id?T.green:T.dim,borderBottom:`2px solid ${normalizedTab===n.id?T.green:'transparent'}`,whiteSpace:'nowrap',fontFamily:FONT,transition:'color 0.15s',letterSpacing:'0.3px'}}>
                {n.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{padding:'32px 40px'}}>
        {topicView?(
          <TopicPage topic={topicView} onBack={()=>setTopicView(null)} stats={stats} qs={qs} pdfMeta={pdfMeta} savePdfForTopic={savePdfForTopic} deletePdfForTopic={deletePdfForTopic} studyNotes={studyNotes} saveStudyNote={saveStudyNote} apiKey={apiKey} topicNotes={topicNotes} saveTopicNote={saveTopicNote} learningData={learningData} saveLearningData={saveLearningData} sr={sr} recordAnswer={recordAnswer} goToBank={goToBank} setTab={setTab}/>
        ):(
          <>
            {normalizedTab==='panel'&&<Dashboard {...shared} examDate={examDate} sessions={sessions} learningData={learningData} setTopicView={setTopicView} setExamDate={setExamDate}/>}
            {normalizedTab==='conocimiento'&&<Temario setTab={setTab} stats={stats} qs={qs} notes={notes} setNote={setNote} pdfMeta={pdfMeta} savePdfForTopic={savePdfForTopic} deletePdfForTopic={deletePdfForTopic} studyNotes={studyNotes} saveStudyNote={saveStudyNote} apiKey={apiKey} goToStudy={t=>{setTopicView(t);}} topicNotes={topicNotes} saveTopicNote={saveTopicNote} setTopicView={setTopicView} learningData={learningData}/>}
            {normalizedTab==='test'&&<TestTab shared={shared} recordAnswer={recordAnswer} addSession={addSession} apiKey={apiKey} testQs={testQs} fcQs={fcQs} dueQs={dueQs} bankPreselect={bankPreselect} onBankPreselect={()=>setBankPreselect(null)} pdfMeta={pdfMeta} stats={stats} learningData={learningData}/>}
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
      <div style={{background:T.blueS,border:'1px solid #93c5fd',borderRadius:10,padding:'14px 18px',fontSize:13,color:T.blueText,lineHeight:1.6}}>
        <strong>Privacidad:</strong> la API key se guarda únicamente en <code style={{fontSize:11,background:'#bfdbfe',padding:'1px 4px',borderRadius:3}}>localStorage</code> de tu navegador. No se envía a ningún servidor excepto a la API de Anthropic cuando generas preguntas.
      </div>
    </div>
  );
}

// ── PanelTab — Dashboard + Stats + Planificador ───────────────────────────────
function PanelTab({shared,examDate,sessions,stats,setExamDate,goToBank,setTab,errSet,dueQs,learningData,setTopicView}){
  const [subTab,setSubTab]=useState('dashboard');
  const tabs=[{id:'dashboard',label:'Inicio'},{id:'stats',label:'Estadísticas'},{id:'planificador',label:'Planificador'}];
  return(
    <div>
      <div style={{display:'flex',borderBottom:`1px solid ${T.border}`,marginBottom:22,gap:0}}>
        {tabs.map(t=><button key={t.id} onClick={()=>setSubTab(t.id)} style={{padding:'8px 14px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:subTab===t.id?600:400,color:subTab===t.id?T.blue:T.muted,borderBottom:`2px solid ${subTab===t.id?T.blue:'transparent'}`,fontFamily:FONT}}>{t.label}</button>)}
      </div>
      {subTab==='dashboard'   &&<Dashboard {...shared} examDate={examDate} sessions={sessions} learningData={learningData} setTopicView={setTopicView}/>}
      {subTab==='stats'       &&<StatsView {...shared} sessions={sessions}/>}
      {subTab==='planificador'&&<Planificador stats={stats} examDate={examDate} setExamDate={setExamDate} goToBank={goToBank}/>}
    </div>
  );
}

// ── TemarioConEstudio — Temario + visor de apuntes integrado ──────────────────
function TemarioConEstudio({setTab,stats,qs,notes,setNote,pdfMeta,savePdfForTopic,deletePdfForTopic,studyNotes,saveStudyNote,apiKey,studyPreselect,onStudyPreselect,goToStudy,topicNotes,saveTopicNote,setTopicView,learningData}){
  const [subTab,setSubTab]=useState(studyPreselect?'estudio':'temario');
  useEffect(()=>{if(studyPreselect){setSubTab('estudio');}},[studyPreselect]);
  const totalNotes=Object.keys(studyNotes).length;
  return(
    <div>
      <div style={{display:'flex',borderBottom:`1px solid ${T.border}`,marginBottom:22,gap:0}}>
        <button onClick={()=>setSubTab('temario')} style={{padding:'8px 14px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:subTab==='temario'?600:400,color:subTab==='temario'?T.blue:T.muted,borderBottom:`2px solid ${subTab==='temario'?T.blue:'transparent'}`,fontFamily:FONT}}>Temario</button>
        <button onClick={()=>setSubTab('estudio')} style={{padding:'8px 14px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:subTab==='estudio'?600:400,color:subTab==='estudio'?T.teal:T.muted,borderBottom:`2px solid ${subTab==='estudio'?T.teal:'transparent'}`,fontFamily:FONT}}>
          📖 Apuntes {totalNotes>0&&<span style={{fontSize:10,background:T.tealS,color:T.teal,padding:'1px 6px',borderRadius:10,marginLeft:4,fontWeight:700}}>{totalNotes}</span>}
        </button>
      </div>
      {subTab==='temario'&&<Temario setTab={setTab} stats={stats} qs={qs} notes={notes} setNote={setNote} pdfMeta={pdfMeta} savePdfForTopic={savePdfForTopic} deletePdfForTopic={deletePdfForTopic} studyNotes={studyNotes} saveStudyNote={saveStudyNote} apiKey={apiKey} goToStudy={t=>{setSubTab('estudio');goToStudy(t);}} topicNotes={topicNotes} saveTopicNote={saveTopicNote} setTopicView={setTopicView} learningData={learningData}/>}
      {subTab==='estudio'&&<EstudioTab studyNotes={studyNotes} saveStudyNote={saveStudyNote} apiKey={apiKey} preselect={studyPreselect} onPreselect={onStudyPreselect} pdfMeta={pdfMeta}/>}
    </div>
  );
}

// ── PracticaTab — Test OPE + Simulacro + Flashcards ──────────────────────────
function PracticaTab({shared,recordAnswer,addSession,apiKey,testQs,fcQs,dueQs}){
  const [subTab,setSubTab]=useState('test');
  return(
    <div>
      <div style={{display:'flex',borderBottom:`1px solid ${T.border}`,marginBottom:22,gap:0}}>
        <button onClick={()=>setSubTab('test')} style={{padding:'8px 14px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:subTab==='test'?600:400,color:subTab==='test'?T.blue:T.muted,borderBottom:`2px solid ${subTab==='test'?T.blue:'transparent'}`,fontFamily:FONT}}>🧪 Test OPE</button>
        <button onClick={()=>setSubTab('simulacro')} style={{padding:'8px 14px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:subTab==='simulacro'?600:400,color:subTab==='simulacro'?T.orange:T.muted,borderBottom:`2px solid ${subTab==='simulacro'?T.orange:'transparent'}`,fontFamily:FONT}}>⚡ Simulacro</button>
        <button onClick={()=>setSubTab('flashcard')} style={{padding:'8px 14px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:subTab==='flashcard'?600:400,color:subTab==='flashcard'?T.teal:T.muted,borderBottom:`2px solid ${subTab==='flashcard'?T.teal:'transparent'}`,fontFamily:FONT}}>
          🃏 Flashcards {dueQs.length>0&&<span style={{fontSize:10,background:T.amberS,color:T.amber,padding:'1px 6px',borderRadius:10,marginLeft:4,fontWeight:700}}>{dueQs.length}</span>}
        </button>
      </div>
      {subTab==='test'      &&<TestMode {...shared}/>}
      {subTab==='simulacro' &&<Simulacro testQs={testQs} recordAnswer={recordAnswer} addSession={addSession} apiKey={apiKey}/>}
      {subTab==='flashcard' &&<FlashcardMode {...shared}/>}
    </div>
  );
}

// ── TestTab — Test OPE + Simulacro + Flashcards + Banco (3-tab architecture) ─
function TestTab({shared,recordAnswer,addSession,apiKey,testQs,fcQs,dueQs,bankPreselect,onBankPreselect,pdfMeta,stats,learningData}){
  const [subTab,setSubTab]=useState('test');
  return(
    <div>
      <div style={{display:'flex',borderBottom:`1px solid ${T.border}`,marginBottom:22,gap:0}}>
        <button onClick={()=>setSubTab('test')} style={{padding:'8px 14px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:subTab==='test'?600:400,color:subTab==='test'?T.blue:T.muted,borderBottom:`2px solid ${subTab==='test'?T.blue:'transparent'}`,fontFamily:FONT}}>🧪 Test OPE</button>
        <button onClick={()=>setSubTab('simulacro')} style={{padding:'8px 14px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:subTab==='simulacro'?600:400,color:subTab==='simulacro'?T.orange:T.muted,borderBottom:`2px solid ${subTab==='simulacro'?T.orange:'transparent'}`,fontFamily:FONT}}>⚡ Simulacro</button>
        <button onClick={()=>setSubTab('flashcard')} style={{padding:'8px 14px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:subTab==='flashcard'?600:400,color:subTab==='flashcard'?T.teal:T.muted,borderBottom:`2px solid ${subTab==='flashcard'?T.teal:'transparent'}`,fontFamily:FONT}}>
          🃏 Flashcards {dueQs.length>0&&<span style={{fontSize:10,background:T.amberS,color:T.amber,padding:'1px 6px',borderRadius:10,marginLeft:4,fontWeight:700}}>{dueQs.length}</span>}
        </button>
        <button onClick={()=>setSubTab('banco')} style={{padding:'8px 14px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:subTab==='banco'?600:400,color:subTab==='banco'?T.purple:T.muted,borderBottom:`2px solid ${subTab==='banco'?T.purple:'transparent'}`,fontFamily:FONT}}>📦 Banco</button>
      </div>
      {subTab==='test'      &&<TestMode {...shared}/>}
      {subTab==='simulacro' &&<Simulacro testQs={testQs} recordAnswer={recordAnswer} addSession={addSession} apiKey={apiKey}/>}
      {subTab==='flashcard' &&<FlashcardMode {...shared}/>}
      {subTab==='banco'     &&<BankManager {...shared} preselect={bankPreselect} onPreselect={onBankPreselect} pdfMeta={pdfMeta} apiKey={apiKey}/>}
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

// ── TopicNotesPanel ───────────────────────────────────────────────────────────
function TopicNotesPanel({topic,value,onChange,onClose,editing,setEditing}){
  const taRef=useRef(null);
  const [saved,setSaved]=useState(false);
  const wordCount=value.trim()?value.trim().split(/\s+/).length:0;
  const lineCount=value?value.split('\n').length:0;

  const handleChange=e=>{onChange(e.target.value);setSaved(false);};
  const handleBlur=()=>{setSaved(true);setTimeout(()=>setSaved(false),2000);};

  const insert=(before,after='',placeholder='texto')=>{
    const ta=taRef.current;if(!ta)return;
    const s=ta.selectionStart,e=ta.selectionEnd;
    const sel=value.slice(s,e)||placeholder;
    const next=value.slice(0,s)+before+sel+after+value.slice(e);
    onChange(next);
    setTimeout(()=>{ta.focus();ta.setSelectionRange(s+before.length,s+before.length+sel.length);},0);
  };

  const insertLine=(prefix)=>{
    const ta=taRef.current;if(!ta)return;
    const s=ta.selectionStart;
    const lineStart=value.lastIndexOf('\n',s-1)+1;
    const next=value.slice(0,lineStart)+prefix+value.slice(lineStart);
    onChange(next);
    setTimeout(()=>{ta.focus();ta.setSelectionRange(s+prefix.length,s+prefix.length);},0);
  };

  const renderLine=(line,i)=>{
    if(!line.trim()) return <div key={i} style={{height:10}}/>;
    if(line.startsWith('## ')) return <div key={i} style={{fontWeight:700,fontSize:16,color:T.text,margin:'16px 0 6px',borderBottom:`2px solid ${T.border}`,paddingBottom:4}}>{line.slice(3)}</div>;
    if(line.startsWith('# ')) return <div key={i} style={{fontWeight:800,fontSize:19,color:T.text,margin:'20px 0 8px',letterSpacing:-0.5}}>{line.slice(2)}</div>;
    if(line.startsWith('> ')) return <div key={i} style={{borderLeft:`3px solid ${T.teal}`,background:T.tealS,padding:'6px 12px',borderRadius:'0 6px 6px 0',fontSize:13,color:T.tealText,margin:'6px 0',lineHeight:1.6}}>{renderInline(line.slice(2))}</div>;
    if(line.startsWith('! ')) return <div key={i} style={{borderLeft:`3px solid ${T.amber}`,background:T.amberS,padding:'6px 12px',borderRadius:'0 6px 6px 0',fontSize:13,color:T.amberText,margin:'6px 0',fontWeight:600,lineHeight:1.6}}>⚠️ {renderInline(line.slice(2))}</div>;
    if(line.match(/^---+$/)) return <hr key={i} style={{border:'none',borderTop:`1px solid ${T.border}`,margin:'12px 0'}}/>;
    if(line.match(/^(\s*[-•*]|\d+\.) /)){
      const isNum=line.match(/^\d+\./);
      const depth=(line.match(/^\s+/)||[''])[0].length;
      const text=line.replace(/^\s*[-•*\d.]+\s*/,'');
      return <div key={i} style={{display:'flex',gap:8,alignItems:'flex-start',marginBottom:4,paddingLeft:depth*12}}>
        <span style={{color:isNum?T.blue:T.green,fontWeight:700,flexShrink:0,minWidth:16,marginTop:1,fontSize:isNum?12:16}}>{isNum?line.match(/^(\d+)/)[1]+'.':'·'}</span>
        <span style={{fontSize:13,color:T.text,lineHeight:1.65}}>{renderInline(text)}</span>
      </div>;
    }
    return <div key={i} style={{fontSize:13,color:T.text,lineHeight:1.75,marginBottom:2}}>{renderInline(line)}</div>;
  };

  const renderInline=(text)=>{
    const parts=[];let remaining=text;let ki=0;
    const re=/\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/g;let m;let last=0;
    while((m=re.exec(text))!==null){
      if(m.index>last)parts.push(<span key={ki++}>{text.slice(last,m.index)}</span>);
      if(m[1]) parts.push(<strong key={ki++} style={{color:T.text,fontWeight:700}}>{m[1]}</strong>);
      else if(m[2]) parts.push(<em key={ki++} style={{color:T.muted}}>{m[2]}</em>);
      else if(m[3]) parts.push(<code key={ki++} style={{background:T.blueS,color:T.blueText,padding:'1px 5px',borderRadius:4,fontSize:12,fontFamily:'DM Mono,monospace'}}>{m[3]}</code>);
      last=m.index+m[0].length;
    }
    if(last<text.length)parts.push(<span key={ki++}>{text.slice(last)}</span>);
    return parts.length?parts:text;
  };

  const TBtn=({onClick,title,children,active})=>(
    <button onClick={onClick} title={title}
      style={{background:active?T.tealS:'none',border:active?`1px solid ${T.teal}`:'1px solid transparent',borderRadius:5,padding:'3px 7px',cursor:'pointer',color:active?T.teal:T.muted,fontSize:12,fontFamily:FONT,fontWeight:600,lineHeight:1.4,transition:'all 0.1s'}}>
      {children}
    </button>
  );

  return(
    <div style={{marginTop:10,marginLeft:17,borderRadius:12,border:`1px solid ${T.border}`,overflow:'hidden',boxShadow:sh.md,background:T.surface}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',background:`linear-gradient(90deg,${T.tealS},${T.blueS})`,borderBottom:`1px solid ${T.border}`}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:14}}>📝</span>
          <div>
            <div style={{fontSize:12,fontWeight:700,color:T.tealText}}>{topic.split('.')[0]} — Mis apuntes</div>
            <div style={{fontSize:10,color:T.muted}}>{wordCount} palabras · {lineCount} líneas {saved&&<span style={{color:T.green}}>· ✓ Guardado</span>}</div>
          </div>
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <button onClick={()=>setEditing(!editing)}
            style={{background:editing?T.teal:T.surface,color:editing?'#fff':T.teal,border:`1px solid ${T.teal}`,borderRadius:8,padding:'4px 12px',fontSize:11,cursor:'pointer',fontFamily:FONT,fontWeight:700}}>
            {editing?'👁 Vista previa':'✏️ Editar'}
          </button>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:T.dim,fontSize:18,padding:'0 4px',lineHeight:1}}>×</button>
        </div>
      </div>

      {/* Toolbar — only in edit mode */}
      {editing&&(
        <div style={{display:'flex',alignItems:'center',gap:2,padding:'6px 10px',background:T.card,borderBottom:`1px solid ${T.border}`,flexWrap:'wrap'}}>
          <TBtn onClick={()=>insertLine('# ')} title="Título H1">H1</TBtn>
          <TBtn onClick={()=>insertLine('## ')} title="Título H2">H2</TBtn>
          <div style={{width:1,height:16,background:T.border,margin:'0 4px'}}/>
          <TBtn onClick={()=>insert('**','**')} title="Negrita"><strong>B</strong></TBtn>
          <TBtn onClick={()=>insert('*','*')} title="Cursiva"><em>I</em></TBtn>
          <TBtn onClick={()=>insert('`','`')} title="Código">{'<>'}</TBtn>
          <div style={{width:1,height:16,background:T.border,margin:'0 4px'}}/>
          <TBtn onClick={()=>insertLine('- ')} title="Lista">• Lista</TBtn>
          <TBtn onClick={()=>insertLine('1. ')} title="Lista numerada">1. Lista</TBtn>
          <div style={{width:1,height:16,background:T.border,margin:'0 4px'}}/>
          <TBtn onClick={()=>insertLine('> ')} title="Cita / destacado">💬 Cita</TBtn>
          <TBtn onClick={()=>insertLine('! ')} title="Aviso / perla">⚠️ Perla</TBtn>
          <div style={{width:1,height:16,background:T.border,margin:'0 4px'}}/>
          <TBtn onClick={()=>onChange(value+'\n---\n')} title="Separador">―――</TBtn>
          <div style={{flex:1}}/>
          <span style={{fontSize:10,color:T.dim,fontStyle:'italic'}}>** negrita **  · * cursiva * · ` código `</span>
        </div>
      )}

      {/* Body: edit or preview */}
      {editing?(
        <textarea
          ref={taRef}
          autoFocus
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={'# Título del tema\n\n## Valores de referencia\n- Glucosa basal: 70–100 mg/dL\n- HbA1c diagnóstico DM: ≥6.5%\n\n## Mecanismos clave\n**Resistencia insulínica** → hiperglucemia crónica\n\n> Perla: el péptido C distingue DM1 de DM2\n\n! La HbA1c no sirve en hemoglobinopatías\n\n## Técnicas analíticas\n1. Glucosa en plasma venoso (hexoquinasa)\n2. HbA1c por HPLC o inmunoturbidimetría'}
          style={{width:'100%',minHeight:280,background:T.surface,color:T.text,border:'none',padding:'16px 18px',fontSize:13,fontFamily:FONT,resize:'vertical',outline:'none',boxSizing:'border-box',lineHeight:1.8,tabSize:2}}
        />
      ):(
        <div style={{padding:'18px 20px',minHeight:120,background:T.surface}}>
          {value.trim()?(
            <div>{value.split('\n').map((line,i)=>renderLine(line,i))}</div>
          ):(
            <div style={{textAlign:'center',padding:'32px 0',color:T.dim}}>
              <div style={{fontSize:28,marginBottom:8}}>📝</div>
              <div style={{fontSize:13,fontWeight:500,color:T.muted,marginBottom:4}}>Sin apuntes para este tema</div>
              <div style={{fontSize:12,color:T.dim}}>Pulsa Editar para empezar</div>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div style={{padding:'8px 14px',background:T.card,borderTop:`1px solid ${T.border}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <span style={{fontSize:10,color:T.dim}}>
          Markdown: <code style={{background:T.blueS,color:T.blueText,padding:'0 4px',borderRadius:3,fontSize:9}}># H1</code>{' '}
          <code style={{background:T.blueS,color:T.blueText,padding:'0 4px',borderRadius:3,fontSize:9}}>## H2</code>{' '}
          <code style={{background:T.blueS,color:T.blueText,padding:'0 4px',borderRadius:3,fontSize:9}}>**negrita**</code>{' '}
          <code style={{background:T.blueS,color:T.blueText,padding:'0 4px',borderRadius:3,fontSize:9}}>&gt; cita</code>{' '}
          <code style={{background:T.amberS,color:T.amberText,padding:'0 4px',borderRadius:3,fontSize:9}}>! perla</code>
        </span>
        {value&&<button onClick={()=>{if(confirm('¿Borrar todos los apuntes de este tema?'))onChange('');}} style={{background:'none',border:'none',cursor:'pointer',fontSize:10,color:T.dim,fontFamily:FONT}}>🗑 Borrar</button>}
      </div>
    </div>
  );
}

// ── Primitives ────────────────────────────────────────────────────────────────
function Chip({color,bg,children}){return <span style={{background:bg,color,padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:600}}>{children}</span>;}
function Lbl({children}){return <div style={{fontSize:11,color:T.muted,fontWeight:700,marginBottom:6,letterSpacing:0.5,textTransform:'uppercase'}}>{children}</div>;}
function Btn({onClick,disabled,children,variant='primary',style:st}){
  const v={primary:{bg:T.blue,c:'#fff',b:T.blueDk},green:{bg:T.green,c:'#fff',b:T.greenDk},ghost:{bg:T.surface,c:T.text,b:T.border2},danger:{bg:T.redS,c:T.red,b:'#fca5a5'},teal:{bg:T.teal,c:'#fff',b:T.tealDk},purple:{bg:T.purple,c:'#fff',b:T.purpleDk},orange:{bg:T.orange,c:'#fff',b:'#c2410c'}}[variant];
  return <button onClick={onClick} disabled={disabled} style={{background:disabled?T.card:v.bg,color:disabled?T.dim:v.c,border:'none',borderRadius:12,padding:'10px 22px',fontWeight:700,fontSize:13,cursor:disabled?'not-allowed':'pointer',fontFamily:FONT,boxShadow:disabled?'none':sh.sm,letterSpacing:'0.1px',...st}}>{children}</button>;
}
function RadioGroup({options,value,onChange}){
  return <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:16}}>
    {options.map(o=><label key={String(o.value)} style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer',padding:'8px 12px',borderRadius:7,background:value===o.value?T.blueS:'transparent',border:`1px solid ${value===o.value?T.blue:T.border}`,transition:'all 0.15s'}}>
      <input type="radio" checked={value===o.value} onChange={()=>onChange(o.value)} style={{accentColor:T.blue}}/>
      <span style={{fontSize:13,color:value===o.value?T.blue:T.text,fontWeight:value===o.value?600:400}}>{o.label}</span>
    </label>)}
  </div>;
}
function PBar({pct,color,height=6}){const c=color||(pct>=70?T.green:pct>=50?T.amber:T.red);return <div style={{background:T.border,borderRadius:4,height}}><div style={{background:c,width:`${Math.min(pct,100)}%`,height:'100%',borderRadius:4,transition:'width 0.5s'}}/></div>;}
function Card({children,style:st}){return <div style={{background:T.surface,borderRadius:20,boxShadow:sh.md,...st}}>{children}</div>;}
function Sel({value,onChange,children,style:st}){return <select value={value} onChange={e=>onChange(e.target.value)} style={{width:'100%',background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:7,padding:'9px 12px',fontSize:13,outline:'none',marginBottom:14,fontFamily:FONT,boxShadow:sh.sm,...st}}>{children}</select>;}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════
function Dashboard({qs,testQs,fcQs,dueQs,stats,errSet,marked,setTab,examDate,sessions,learningData,setTopicView,setExamDate}){
  const totalA=Object.values(stats).reduce((a,b)=>a+b.t,0);
  const totalC=Object.values(stats).reduce((a,b)=>a+b.c,0);
  const acc=totalA?Math.round(totalC/totalA*100):0;
  const studied=ALL_TOPICS.filter(t=>stats[t]?.t>0).length;
  const dominated=ALL_TOPICS.filter(t=>getStatus(t,stats)==='dominado').length;
  const daysLeft=examDate?Math.max(0,Math.ceil((new Date(examDate).setHours(23,59,59)-Date.now())/86400000)):null;

  const kpis=[
    {label:'Test OPE',value:testQs.length,color:T.blue,bg:T.blueS,tab:'test',icon:'🧪'},
    {label:'Flashcards',value:fcQs.length,color:T.teal,bg:T.tealS,tab:'flashcard',icon:'🃏'},
    {label:'Para repasar',value:dueQs.length,color:T.amber,bg:T.amberS,tab:'flashcard',icon:'⏰'},
    {label:'Con errores',value:errSet.size,color:T.red,bg:T.redS,tab:'test',icon:'❌'},
    {label:'Temas vistos',value:`${studied}/${ALL_TOPICS.length}`,color:T.green,bg:T.greenS,tab:'temario',icon:'📋'},
    {label:'Dominados',value:dominated,color:T.greenDk,bg:T.greenS,tab:'stats',icon:'🏆'},
  ];

  return(
    <div>
      <div style={{marginBottom:24,display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:700,margin:'0 0 4px',color:T.text,letterSpacing:-0.5}}>Hola, Miguel 👋</h1>
          <p style={{color:T.muted,margin:0,fontSize:14}}>{totalA>0?`${totalA} preg. respondidas · ${acc}% aciertos · OPE FEA Lab. Clínico SESCAM 2025`:'Empieza con el Temario o un Simulacro de examen.'}</p>
        </div>
        {daysLeft!==null&&(
          <div style={{background:daysLeft<30?T.redS:daysLeft<90?T.amberS:T.blueS,border:`1px solid ${daysLeft<30?'#fca5a5':daysLeft<90?'#fde68a':'#93c5fd'}`,borderRadius:10,padding:'12px 20px',textAlign:'center',cursor:'pointer'}} onClick={()=>setTab('planificador')}>
            <div style={{fontSize:30,fontWeight:800,color:daysLeft<30?T.red:daysLeft<90?T.amber:T.blue,lineHeight:1}}>{daysLeft}</div>
            <div style={{fontSize:11,color:T.muted,marginTop:2}}>días para la OPE</div>
          </div>
        )}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:12,marginBottom:24}}>
        {kpis.map(k=><div key={k.label} onClick={()=>setTab(k.tab)} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'16px',cursor:'pointer',boxShadow:sh.sm,transition:'all 0.15s'}} onMouseEnter={e=>{e.currentTarget.style.borderColor=k.color;e.currentTarget.style.boxShadow=sh.md;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.boxShadow=sh.sm;}}>
          <div style={{width:32,height:32,borderRadius:8,background:k.bg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,marginBottom:10}}>{k.icon}</div>
          <div style={{fontSize:22,fontWeight:700,color:k.color,lineHeight:1}}>{k.value}</div>
          <div style={{fontSize:12,color:T.muted,marginTop:4}}>{k.label}</div>
        </div>)}
      </div>

      <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:28}}>
        <Btn onClick={()=>setTab('simulacro')} variant="orange">⚡ Simulacro examen</Btn>
        <Btn onClick={()=>setTab('test')} disabled={testQs.length===0}>🧪 Test rápido</Btn>
        <Btn onClick={()=>setTab('flashcard')} disabled={dueQs.length===0} variant="teal">🃏 Repasar {dueQs.length>0?`(${dueQs.length})`:''}</Btn>
        <Btn onClick={()=>setTab('planificador')} variant="ghost">📅 Planificador</Btn>
      </div>

      {/* Repasos pendientes hoy + Learning progress */}
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
        const hasContent=pending.length>0||learningTopics.length>0;
        if(!hasContent)return null;
        return(
          <Card style={{padding:'18px 22px',marginBottom:20,borderLeft:`3px solid ${T.purple}`}}>
            <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:12,display:'flex',alignItems:'center',gap:8}}><span style={{width:3,height:16,background:T.purple,borderRadius:2,display:'block'}}/>🧠 Aprendizaje interactivo</div>
            {pending.length>0&&(
              <div style={{marginBottom:learningTopics.length?12:0}}>
                <div style={{fontSize:11,fontWeight:700,color:T.purple,marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Repasos pendientes hoy</div>
                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                  {pending.map((p,i)=>(
                    <div key={i} onClick={()=>setTopicView&&setTopicView(p.topic)} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 12px',background:T.purpleS,borderRadius:8,border:`1px solid ${T.border}`,cursor:'pointer',transition:'all 0.15s'}} onMouseEnter={e=>{e.currentTarget.style.borderColor=T.purple;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;}}>
                      <span style={{background:T.purple+'20',color:T.purple,padding:'2px 8px',borderRadius:20,fontSize:10,fontWeight:600,flexShrink:0}}>{p.label}</span>
                      <span style={{fontSize:11,color:T.text,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.topic}</span>
                      <span style={{fontSize:11,color:T.purple,fontWeight:600}}>Repasar →</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {learningTopics.length>0&&(
              <div>
                <div style={{fontSize:11,fontWeight:700,color:T.muted,marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Progreso por tema</div>
                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                  {learningTopics.map(({topic:tp,ls},i)=>(
                    <div key={i} onClick={()=>setTopicView&&setTopicView(tp)} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 12px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.border}`,background:T.card}} onMouseEnter={e=>{e.currentTarget.style.borderColor=ls.color;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;}}>
                      <span style={{width:8,height:8,borderRadius:'50%',background:ls.color,flexShrink:0}}/>
                      <span style={{fontSize:11,color:T.text,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tp}</span>
                      <span style={{fontSize:10,color:T.muted}}>{ls.generated}/{ls.total} sec.</span>
                      <span style={{fontSize:11,fontWeight:700,color:ls.color}}>{ls.mastery}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
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
function Temario({setTab,stats,qs,notes,setNote,pdfMeta,savePdfForTopic,deletePdfForTopic,studyNotes,saveStudyNote,apiKey,goToStudy,topicNotes,saveTopicNote,setTopicView,learningData}){
  const [open,setOpen]=useState(null);
  const [openNote,setOpenNote]=useState(null);
  const [editingNote,setEditingNote]=useState(null);
  const [openPdf,setOpenPdf]=useState(null); // {topic, fileId, name}
  const [splittingKey,setSplittingKey]=useState(null);
  const [generatingStudy,setGeneratingStudy]=useState(null);
  const [studyMsg,setStudyMsg]=useState({});
  const studied=ALL_TOPICS.filter(t=>stats[t]?.t>0).length;

  const generateStudy=async(topic)=>{
    setGeneratingStudy(topic);setStudyMsg(prev=>({...prev,[topic]:'🤖 Generando apuntes...'}));
    const prompt=buildStudyPrompt(topic,false);
    try{
      const res=await fetch('/api/anthropic',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:8192,messages:[{role:'user',content:prompt}]})
      });
      if(!res.ok){const d=await res.json().catch(()=>({}));throw new Error(d?.error?.message||`HTTP ${res.status}`);}
      const data=await res.json();
      const text=(data.content||[]).map(c=>c.text||'').join('').trim();
      const cleaned=text.replace(/```json|```/g,'').trim();
      const parsed=JSON.parse(repairJSON(cleaned));
      saveStudyNote(topic,parsed);
      setStudyMsg(prev=>({...prev,[topic]:''}));
    }catch(e){setStudyMsg(prev=>({...prev,[topic]:`❌ ${e.message}`}));}
    setGeneratingStudy(null);
  };
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
        <div style={{background:'#fef9c3',border:'1px solid #fde047',borderRadius:7,padding:'5px 12px',fontSize:12,color:T.amberText}}>📙 <strong>Henry</strong> El Laboratorio en el Diagnóstico Clínico (2022)</div>
      </div>

      <div style={{display:'flex',flexDirection:'column',borderRadius:14,overflow:'hidden',border:`1px solid ${T.border}`,boxShadow:sh.sm}}>
        {SECTIONS.map((s,si)=>{
          const acc=getAcc(s);const count=getCount(s);const isOpen=open===s.id;
          const tStr=s.temas.length===1?`T${s.temas[0]}`:`T${s.temas[0]}–T${s.temas[s.temas.length-1]}`;
          const topicsWithData=s.topics.map(t=>{
            const ts=stats[t];const tpct=ts?Math.round(ts.c/ts.t*100):null;
            const st=getStatus(t,stats);const refs=TOPIC_REFS[t];
            const pKey=topicPdfKey(t);const files=pdfMeta[pKey]||[];
            const hasPdfs=files.length>0;const hasStudy=!!studyNotes[t];
            const ls=learningData[t]?getLearningStatus(learningData[t]):null;
            return{t,ts,tpct,st,refs,pKey,files,hasPdfs,hasStudy,ls};
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
                  <div style={{fontSize:11,color:T.muted,marginTop:2}}>{tStr} · {s.temas.length} temas · {count} preg. en banco</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
                  {acc!==null&&<span style={{fontWeight:700,fontSize:15,color:acc>=70?T.green:acc>=50?T.amber:T.red,minWidth:36,textAlign:'right'}}>{acc}%</span>}
                  <span style={{color:T.dim,fontSize:18,transition:'transform 0.2s',transform:isOpen?'rotate(90deg)':'none',lineHeight:1}}>›</span>
                </div>
              </div>

              {/* Expanded topics */}
              {isOpen&&(
                <div style={{background:T.card,borderTop:`1px solid ${T.border}`}}>
                  {topicsWithData.map(({t,tpct,st,refs,pKey,files,hasPdfs,hasStudy,ls},ti)=>{
                    const isGenerating=generatingStudy===t;
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
                            <button onClick={()=>hasStudy?goToStudy(t):generateStudy(t)} disabled={isGenerating}
                              style={{background:isGenerating?T.amberS:hasStudy?T.tealS:T.purpleS,border:`1px solid ${isGenerating?T.amber:hasStudy?T.teal:T.purple}`,borderRadius:20,padding:'3px 10px',fontSize:10,cursor:isGenerating?'wait':'pointer',color:isGenerating?T.amberText:hasStudy?T.teal:T.purple,fontWeight:600,fontFamily:FONT,whiteSpace:'nowrap'}}>
                              {isGenerating?'⏳…':hasStudy?'📖 Ver':'📖 Generar'}
                            </button>
                            <button onClick={async()=>{
                              const inp=document.createElement('input');inp.type='file';inp.accept='.pdf';inp.multiple=true;
                              inp.onchange=async e=>{
                                const fs=Array.from(e.target.files||[]);
                                for(const f of fs){
                                  if(f.size>200*1024*1024){alert(`"${f.name}" supera 200 MB.`);continue;}
                                  setSplittingKey(pKey);await savePdfForTopic(t,f);setSplittingKey(null);
                                }
                              };inp.click();
                            }} disabled={splittingKey===pKey}
                              style={{background:splittingKey===pKey?T.amberS:hasPdfs?T.greenS:T.blueS,border:`1px solid ${splittingKey===pKey?T.amber:hasPdfs?'#86efac':T.border2}`,borderRadius:20,padding:'3px 10px',fontSize:10,cursor:splittingKey===pKey?'wait':'pointer',color:splittingKey===pKey?T.amberText:hasPdfs?T.greenText:T.blueText,fontWeight:600,fontFamily:FONT,whiteSpace:'nowrap'}}>
                              {splittingKey===pKey?'⏳…':hasPdfs?`📄 ${files.length}`:'+ PDF'}
                            </button>
                            {ls&&ls.status!=='sinEmpezar'&&(
                              <span style={{background:ls.color+'18',border:`1px solid ${ls.color}`,borderRadius:20,padding:'3px 8px',fontSize:10,color:ls.color,fontWeight:700,fontFamily:FONT,whiteSpace:'nowrap'}}>
                                🧠 {ls.label}
                              </span>
                            )}
                          </div>
                        </div>
                        {hasPdfs&&(
                          <div style={{paddingLeft:17,marginTop:5,display:'flex',flexWrap:'wrap',gap:4}}>
                            {files.map(f=>{
                              const isViewingThis=openPdf&&openPdf.topic===t&&openPdf.fileId===f.id;
                              return(
                                <div key={f.id} style={{display:'flex',alignItems:'center',gap:0,background:isViewingThis?T.green:T.greenS,borderRadius:6,overflow:'hidden',border:`1px solid ${isViewingThis?T.greenDk:'#86efac'}`}}>
                                  <button onClick={()=>setOpenPdf(isViewingThis?null:{topic:t,fileId:f.id,name:f.name})}
                                    style={{background:'none',border:'none',cursor:'pointer',padding:'3px 8px',display:'flex',alignItems:'center',gap:4}}>
                                    <span style={{fontSize:10,color:isViewingThis?'#fff':T.greenText,fontWeight:600,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                                      {isViewingThis?'▼':'📄'} {f.name}
                                    </span>
                                    {f.pages&&<span style={{fontSize:9,color:isViewingThis?'#ffffffaa':T.muted}}>pp.{f.pages}</span>}
                                  </button>
                                  <button onClick={()=>deletePdfForTopic(t,f.id)} style={{background:'none',border:'none',borderLeft:`1px solid ${isViewingThis?T.greenDk:'#86efac'}`,cursor:'pointer',color:isViewingThis?'#fff':T.dim,fontSize:12,padding:'3px 6px',lineHeight:1}}>×</button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {hasRefs&&(
                          <div style={{paddingLeft:17,marginTop:4,display:'flex',gap:5,flexWrap:'wrap'}}>
                            <span style={{fontSize:10,color:T.blueText,background:T.blueS,border:`1px solid ${T.border2}`,padding:'1px 7px',borderRadius:20,fontWeight:600}}>📘 Tietz {refs.tietz}</span>
                            <span style={{fontSize:10,color:T.amberText,background:'#fef9c3',border:'1px solid #fde047',padding:'1px 7px',borderRadius:20,fontWeight:600}}>📙 Henry {refs.henry}</span>
                          </div>
                        )}
                        {/* Texto oficial DOCM */}
                        {(()=>{const num=parseInt(t.match(/^T(\d+)/)?.[1]);const txt=num&&TOPIC_OFFICIAL[num];if(!txt)return null;return(
                          <div style={{paddingLeft:17,marginTop:5}}>
                            <details>
                              <summary style={{fontSize:10,color:T.muted,cursor:'pointer',fontWeight:600,userSelect:'none',listStyle:'none',display:'flex',alignItems:'center',gap:4}}>
                                <span style={{fontSize:9,color:T.dim}}>▶</span> Ver temario oficial DOCM
                              </summary>
                              <div style={{marginTop:6,background:'#fffef5',border:'1px solid #fde047',borderRadius:7,padding:'8px 12px',fontSize:11,color:T.text,lineHeight:1.7}}>
                                <span style={{fontSize:9,fontWeight:700,color:T.amberText,display:'block',marginBottom:4,letterSpacing:0.5,textTransform:'uppercase'}}>Tema {num} — Texto oficial DOCM 9/04/2025</span>
                                {txt}
                              </div>
                            </details>
                          </div>
                        );})()}
                        {studyMsg[t]&&<div style={{marginTop:5,fontSize:11,color:studyMsg[t].startsWith('❌')?T.red:T.muted,paddingLeft:17}}>{studyMsg[t]}</div>}
                        {/* PDF viewer inline */}
                        {openPdf&&openPdf.topic===t&&(
                          <PdfViewer key={openPdf.fileId} topic={t} fileId={openPdf.fileId} name={openPdf.name} onClose={()=>setOpenPdf(null)}/>
                        )}
                        {/* Topic notes toggle */}
                        <div style={{paddingLeft:17,marginTop:6}}>
                          <button onClick={()=>setOpenNote(openNote===t?null:t)}
                            style={{background:'none',border:'none',cursor:'pointer',fontSize:11,color:topicNotes[t]?T.teal:T.dim,fontFamily:FONT,padding:0,fontWeight:600,display:'flex',alignItems:'center',gap:4}}>
                            {topicNotes[t]?'📝 Ver apuntes':'📝 Añadir apuntes'}
                            {topicNotes[t]&&<span style={{background:T.tealS,color:T.tealText,fontSize:9,padding:'1px 5px',borderRadius:8,fontWeight:700}}>✓</span>}
                          </button>
                        </div>
                        {openNote===t&&<TopicNotesPanel topic={t} value={topicNotes[t]||''} onChange={v=>saveTopicNote(t,v)} onClose={()=>{setOpenNote(null);setEditingNote(null);}} editing={editingNote===t} setEditing={v=>setEditingNote(v?t:null)}/>}
                      </div>
                    );
                  })}
                  {/* Notes + generate button */}
                  <div style={{padding:'12px 20px',borderTop:`1px solid ${T.border}`,background:s.colorS}}>
                    <div style={{fontSize:11,color:s.color,fontWeight:700,marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Mis notas</div>
                    <textarea defaultValue={notes[s.id]||''} onBlur={e=>setNote(s.id,e.target.value)}
                      placeholder="Notas, esquemas o conceptos clave..."
                      style={{width:'100%',minHeight:60,background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:8,padding:'8px 10px',fontSize:12,fontFamily:FONT,resize:'vertical',outline:'none',boxSizing:'border-box',marginBottom:10}}/>
                    <button onClick={()=>setTab('banco')} style={{background:s.color,color:'#fff',border:'none',borderRadius:8,padding:'7px 18px',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:FONT}}>✨ Generar preguntas de este bloque →</button>
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

// ═══════════════════════════════════════════════════════════════════════════
// ESTUDIO TAB
// ═══════════════════════════════════════════════════════════════════════════
function EstudioTab({studyNotes,saveStudyNote,apiKey,preselect,onPreselect,pdfMeta}){
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
                <div style={{background:T.greenS,border:'1px solid #86efac',borderLeft:`3px solid ${T.green}`,borderRadius:8,padding:'10px 14px',marginBottom:10}}>
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
                      <label key={f.id} style={{display:'flex',alignItems:'center',gap:7,background:sel?'#bbf7d0':T.card,borderRadius:5,padding:'4px 8px',marginBottom:3,cursor:'pointer',border:`1px solid ${sel?'#86efac':T.border}`}}>
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
                <div style={{background:T.blueS,border:'1px solid #93c5fd',borderLeft:`3px solid ${T.blue}`,borderRadius:8,padding:'9px 14px',marginBottom:10,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
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
    'Valores de referencia':{bg:'#eff6ff',border:'#93c5fd',title:'#1d4ed8',icon:'🔢'},
    'Conceptos clave':{bg:T.greenS,border:'#86efac',title:T.greenText,icon:'💡'},
    'Mecanismos fisiopatológicos':{bg:'#faf5ff',border:'#d8b4fe',title:'#7c3aed',icon:'⚙️'},
    'Clasificaciones y criterios diagnósticos':{bg:T.amberS,border:'#fde68a',title:T.amberText,icon:'📋'},
    'Técnicas analíticas de laboratorio':{bg:'#f0fdf4',border:'#bbf7d0',title:'#166534',icon:'🔬'},
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
function TopicPage({topic,onBack,stats,qs,pdfMeta,savePdfForTopic,deletePdfForTopic,studyNotes,saveStudyNote,apiKey,topicNotes,saveTopicNote,learningData,saveLearningData,sr,recordAnswer,goToBank,setTab}){
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

  // Upload PDF for Tietz/Henry — uses savePdfForTopic with suffixed topic key
  const uploadPdf=(source)=>{
    const inp=document.createElement('input');inp.type='file';inp.accept='.pdf';
    inp.onchange=async e=>{const f=e.target.files?.[0];if(!f||f.size>200*1024*1024)return;
      await savePdfForTopic(topic+'§'+source,f);
    };inp.click();
  };
  const tietzFilesReal=pdfMeta[topicPdfKey(topic+'§tietz')]||[];
  const henryFilesReal=pdfMeta[topicPdfKey(topic+'§henry')]||[];

  const tabs=[
    {id:'temario',label:'Temario',icon:'📋',color:T.blue},
    {id:'apuntes',label:'Apuntes',icon:'📖',color:T.teal},
    {id:'aprendizaje',label:'Aprendizaje',icon:'🧠',color:T.purple},
    {id:'banco',label:'Banco',icon:'🧪',color:T.orange},
  ];

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
              {ls&&ls.status!=='sinEmpezar'&&<span style={{fontSize:11,color:ls.color,background:ls.color+'18',padding:'2px 8px',borderRadius:10,fontWeight:600}}>🧠 {ls.label}</span>}
            </div>
          </div>
        </div>
      </div>

      <div style={{display:'flex',borderBottom:`1px solid ${T.border}`,marginBottom:22,gap:0}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{padding:'8px 14px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:activeTab===t.id?600:400,color:activeTab===t.id?t.color:T.muted,borderBottom:`2px solid ${activeTab===t.id?t.color:'transparent'}`,fontFamily:FONT}}>{t.icon} {t.label}</button>
        ))}
      </div>

      {activeTab==='temario'&&(
        <div>
          {officialText&&(
            <Card style={{padding:'18px 22px',marginBottom:16,borderLeft:`3px solid #fde047`}}>
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
                <button onClick={()=>uploadPdf('henry')} style={{fontSize:10,background:'#fef9c3',border:'1px solid #fde047',borderRadius:6,padding:'3px 10px',cursor:'pointer',color:T.amberText,fontWeight:600,fontFamily:FONT}}>
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

          {/* Inline PDF viewer */}
          {viewingPdf&&(
            <PdfViewer topic={viewingPdf.topicKey} fileId={viewingPdf.fileId} name={viewingPdf.name} onClose={()=>setViewingPdf(null)}/>
          )}

          {/* Topic notes */}
          <Card style={{padding:'16px 22px',marginTop:viewingPdf?16:0}}>
            <div style={{fontSize:12,fontWeight:700,color:T.text,marginBottom:8}}>📝 Mis apuntes</div>
            <textarea defaultValue={topicNotes[topic]||''} onBlur={e=>saveTopicNote(topic,e.target.value)} placeholder="Escribe tus apuntes personales sobre este tema..."
              style={{width:'100%',minHeight:100,background:T.card,color:T.text,border:`1px solid ${T.border}`,borderRadius:8,padding:'10px 12px',fontSize:12,fontFamily:FONT,resize:'vertical',outline:'none',boxSizing:'border-box'}}/>
          </Card>
        </div>
      )}

      {activeTab==='apuntes'&&(
        <div>
          {studyNotes[topic]?(
            <StudyPanel data={studyNotes[topic].content} topic={topic} date={studyNotes[topic].date} onRegenerate={()=>{}} isGenerating={false}/>
          ):(
            <Card style={{padding:'50px',textAlign:'center'}}>
              <div style={{fontSize:40,marginBottom:12}}>📖</div>
              <div style={{fontSize:14,color:T.text,fontWeight:600,marginBottom:6}}>No hay apuntes generados</div>
              <div style={{fontSize:12,color:T.muted}}>Ve a la pestaña "Apuntes" del Temario para generar apuntes con IA</div>
            </Card>
          )}
        </div>
      )}

      {activeTab==='aprendizaje'&&<AprendizajeTab topic={topic} learning={learning} saveLearningData={saveLearningData} pdfMeta={pdfMeta}/>}

      {activeTab==='banco'&&(
        <div>
          {topicQs.length>0?(
            <div>
              <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:12}}>{topicQs.length} preguntas de este tema</div>
              {topicQs.slice(0,20).map((q,i)=>(
                <Card key={q.id} style={{padding:'12px 16px',marginBottom:8}}>
                  <div style={{display:'flex',alignItems:'flex-start',gap:8}}>
                    <span style={{fontSize:10,color:T.muted,background:T.card,padding:'2px 6px',borderRadius:4,fontWeight:600,flexShrink:0}}>#{i+1}</span>
                    <div style={{flex:1}}>
                      <div style={{fontSize:12,color:T.text,lineHeight:1.5,marginBottom:6}}>{q.question||q.front}</div>
                      {q.type==='test'&&q.options&&(
                        <div style={{display:'flex',flexDirection:'column',gap:3}}>
                          {q.options.map((o,j)=>(
                            <div key={j} style={{fontSize:11,color:j===q.correct?T.green:T.muted,fontWeight:j===q.correct?600:400,paddingLeft:8}}>{o}</div>
                          ))}
                        </div>
                      )}
                      {q.type==='flashcard'&&<div style={{fontSize:11,color:T.teal,background:T.tealS,padding:'4px 8px',borderRadius:6,marginTop:4}}>{q.back}</div>}
                    </div>
                  </div>
                </Card>
              ))}
              {topicQs.length>20&&<div style={{fontSize:12,color:T.muted,textAlign:'center',padding:12}}>...y {topicQs.length-20} preguntas más</div>}
            </div>
          ):(
            <Card style={{padding:'50px',textAlign:'center'}}>
              <div style={{fontSize:40,marginBottom:12}}>🧪</div>
              <div style={{fontSize:14,color:T.text,fontWeight:600,marginBottom:6}}>Sin preguntas para este tema</div>
              <div style={{fontSize:12,color:T.muted,marginBottom:16}}>Ve al Banco de preguntas para generar preguntas de este tema</div>
              <Btn onClick={()=>{onBack();setTab('banco');}} variant="primary">✨ Generar preguntas</Btn>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// APRENDIZAJE TAB — Secciones desplegables con generación independiente
// ═══════════════════════════════════════════════════════════════════════════
function AprendizajeTab({topic,learning,saveLearningData,pdfMeta}){
  const [newTitle,setNewTitle]=useState('');
  const [openSec,setOpenSec]=useState(null);    // index of open section accordion
  const [activePhase,setActivePhase]=useState({}); // {secIdx: phaseIdx}
  const [genIdx,setGenIdx]=useState(null);       // section being generated
  const [genStep,setGenStep]=useState('');
  const [genPct,setGenPct]=useState(0);
  const [genError,setGenError]=useState('');
  const [extracting,setExtracting]=useState(false);
  const [extractMsg,setExtractMsg]=useState('');

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
            {type:'text',text:`Analiza este documento del tema "${topic}" de bioquímica clínica (FEA Laboratorio Clínico, SESCAM 2025).\n\nIdentifica TODOS los subapartados o secciones principales del capítulo leyendo el índice, tabla de contenidos o encabezados.\n\nDevuelve SOLO JSON válido:\n{"sections":[{"title":"Título exacto tal como aparece en el documento","pageHint":"página aproximada"}]}\n\n- Extrae los subapartados reales (no inventes)\n- Incluye TODAS las secciones principales (5-12 típico)\n- Ordena en el orden del documento`}
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

  const updateSectionText=(idx,text)=>{
    const updated={...data,sections:sections.map((s,i)=>i===idx?{...s,text}:s)};
    save(updated);
  };

  // ── Generate learning for a single section ────────────────────────────────
  const callClaude=async(prompt,maxTokens=4096)=>{
    const res=await fetch('/api/anthropic',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:maxTokens,messages:[{role:'user',content:prompt}]})
    });
    if(!res.ok){const d=await res.json().catch(()=>({}));throw new Error(d?.error?.message||`HTTP ${res.status}`);}
    const r=await res.json();
    const text=(r.content||[]).map(c=>c.text||'').join('').trim();
    return text.replace(/```json|```/g,'').trim();
  };

  // ── Extract topic number for metadata ────────────────────────────────────
  const topicNum=topic.match(/^T(\d+)/)?.[1]||'';
  const topicTag=topicNum?`T${topicNum}`:'';

  const generateSection=async(idx,subIdx)=>{
    // subIdx: if defined, generate for a subsection within section[idx]
    const sec=sections[idx];
    const sub=subIdx!=null?sec.subsections?.[subIdx]:null;
    const targetText=sub?sub.text:sec.text;
    const targetTitle=sub?`${sec.title} > ${sub.title}`:sec.title;
    if(!targetText?.trim()){setGenError('Pega texto primero.');return;}
    setGenIdx(subIdx!=null?`${idx}-${subIdx}`:idx);setGenError('');setGenPct(0);

    const SYS='Eres un experto en bioquímica clínica y preparación de oposiciones FEA Laboratorio Clínico (SESCAM 2025). Responde SOLO con JSON válido parseable con JSON.parse(), sin texto adicional, sin bloques markdown.';
    const CTX=`TEMA: "${topic}"\nSECCIÓN: "${targetTitle}"\n\nTEXTO:\n${targetText.slice(0,30000)}`;
    const now=new Date();
    const dateTag=now.toISOString().slice(0,10);
    // Metadata template for question tagging
    const META=`\n\nIMPORTANTE — cada pregunta DEBE incluir estos campos de metadatos:\n"tema":"${topicTag}","seccion":"${sec.title}","subseccion":"${sub?.title||''}","fechaGeneracion":"${dateTag}"`;
    const DIFF=`\n\nPara cada pregunta incluye: "tipo":"concepto|mecanismo|valor|clinico|aplicacion","dificultad":"baja|media|alta"`;

    try{
      // 1. Extract concepts
      setGenStep('Extrayendo conceptos...');setGenPct(8);
      const rawC=await callClaude(`${SYS}\n\nExtrae TODA la información clave de esta sección.\n\n${CTX}\n\nJSON:\n{"concepts":[{"t":"título (5-8 palabras)","d":"Descripción concisa. Máximo 2 frases.","cat":"concept|value|mechanism|clinical"}]}\n\nSé exhaustivo.`);
      const conceptsParsed=JSON.parse(repairJSON(rawC));
      const conceptList=conceptsParsed.concepts||conceptsParsed;
      const cMap=JSON.stringify(Array.isArray(conceptList)?conceptList.slice(0,150):[]);

      // 2. Pre-test (20 preguntas)
      setGenStep('Generando pre-test (20 preguntas)...');setGenPct(20);
      const p1=await callClaude(`${SYS}\n\nGenera exactamente 20 preguntas tipo test (PRE-TEST) basándote en estos conceptos de "${targetTitle}".\n\nCONCEPTOS:\n${cMap}\n\nMezcla 7 fáciles, 7 medias, 6 difíciles. 4 opciones (A-D).${META}\n\nJSON:\n{"questions":[{"id":"pre1","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0,"explanation":"...","fase":"pretest"${DIFF.slice(1)}}]}`,8192);
      const preTest=JSON.parse(repairJSON(p1));

      // 3. Guided reading
      setGenStep('Generando lectura guiada...');setGenPct(35);
      const p2=await callClaude(`${SYS}\n\nOrganiza estos conceptos de "${targetTitle}" en subsecciones de lectura guiada (3-6).\n\nCONCEPTOS:\n${cMap}\n\nJSON:\n{"sections":[{"title":"...","summary":"...","keyPoints":["..."],"checkQuestion":{"question":"...","answer":"..."}}]}`,8192);
      const guided=JSON.parse(repairJSON(p2));

      // 4. Flashcards (25 tarjetas)
      setGenStep('Generando flashcards (25)...');setGenPct(50);
      const p3=await callClaude(`${SYS}\n\nGenera exactamente 25 flashcards de los conceptos más importantes de "${targetTitle}".\n\nCONCEPTOS:\n${cMap}${META}\n\nJSON:\n{"flashcards":[{"id":"fc1","front":"Pregunta concreta","back":"Respuesta precisa","fase":"flashcard","tipo":"concepto|mecanismo|valor|clinico|aplicacion","tema":"${topicTag}","seccion":"${sec.title}","subseccion":"${sub?.title||''}","fechaGeneracion":"${dateTag}"}]}\n\n25 flashcards exactas. Prioriza valores numéricos, criterios diagnósticos, clasificaciones.`,6144);
      const fc=JSON.parse(repairJSON(p3));

      // 5. Clinical cases (5 casos)
      setGenStep('Generando casos clínicos (5)...');setGenPct(65);
      const p4=await callClaude(`${SYS}\n\nCrea exactamente 5 casos clínicos realistas para "${targetTitle}".\n\nCONCEPTOS:\n${cMap}${META}\n\nJSON:\n{"clinicalCases":[{"id":"cc1","presentation":"Paciente...","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0,"discussion":"...","fase":"caso","tipo":"clinico","dificultad":"alta","tema":"${topicTag}","seccion":"${sec.title}","subseccion":"${sub?.title||''}","fechaGeneracion":"${dateTag}"}]}`,8192);
      const cc=JSON.parse(repairJSON(p4));

      // 6. Post-test (25 preguntas)
      setGenStep('Generando post-test (25 preguntas)...');setGenPct(80);
      const p5=await callClaude(`${SYS}\n\nGenera exactamente 25 preguntas DIFÍCILES (POST-TEST) para "${targetTitle}". Aplicación clínica, diagnóstico diferencial, integración.\n\nCONCEPTOS:\n${cMap}${META}\n\nJSON:\n{"questions":[{"id":"post1","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0,"explanation":"...","fase":"posttest"${DIFF.slice(1)}}]}\n\n25 preguntas exactas, nivel alto.`,8192);
      const postTest=JSON.parse(repairJSON(p5));

      setGenPct(95);setGenStep('Etiquetando y guardando...');

      // Tag all generated items with metadata
      const tag=(arr,fase)=>(Array.isArray(arr)?arr:[]).map((q,i)=>({...q,id:uid(),tema:topicTag,seccion:sec.title,subseccion:sub?.title||'',fase,fechaGeneracion:dateTag,tipo:q.tipo||'concepto',dificultad:q.dificultad||'media'}));
      const taggedPreTest=tag(preTest.questions||preTest,'pretest');
      const taggedPostTest=tag(postTest.questions||postTest,'posttest');
      const taggedFlashcards=(fc.flashcards||fc||[]).map((f,i)=>({...f,id:uid(),tema:topicTag,seccion:sec.title,subseccion:sub?.title||'',fase:'flashcard',fechaGeneracion:dateTag}));
      const taggedClinical=tag(cc.clinicalCases||cc,'caso');

      const addDays=(d,n)=>{const r=new Date(d);r.setDate(r.getDate()+n);return r.toISOString().slice(0,10);};
      const generated={
        generatedAt:now.toISOString(),
        conceptMap:Array.isArray(conceptList)?conceptList:[],
        phases:{
          preTest:taggedPreTest,
          guidedReading:guided.sections||guided,
          flashcards:taggedFlashcards,
          clinicalCases:taggedClinical,
          postTest:taggedPostTest,
        },
        progress:{preTest:null,postTest:null,flashcardsDominated:null,clinicalScore:null}
      };

      let updSections;
      if(subIdx!=null){
        // Update subsection
        const updSubs=(sec.subsections||[]).map((s,i)=>i===subIdx?{...s,generated}:s);
        updSections=sections.map((s,i)=>i===idx?{...s,subsections:updSubs}:s);
      }else{
        updSections=sections.map((s,i)=>i===idx?{...s,generated}:s);
      }
      let sr=data.spacedRepetition;
      if(!sr){sr={startDate:now.toISOString().slice(0,10),reviews:{'D+1':{date:addDays(now,1),completed:false},'D+3':{date:addDays(now,3),completed:false},'D+7':{date:addDays(now,7),completed:false},'D+14':{date:addDays(now,14),completed:false},'D+30':{date:addDays(now,30),completed:false}}};}
      await save({...data,sections:updSections,spacedRepetition:sr});
      setGenStep('');setGenPct(100);
    }catch(e){setGenError(`Error: ${e.message}`);}
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
    {id:'guidedReading',label:'Lectura Guiada',icon:'📖',color:T.teal},
    {id:'flashcards',label:'Flashcards',icon:'🃏',color:T.green},
    {id:'clinicalCases',label:'Casos Clínicos',icon:'🏥',color:T.orange},
    {id:'postTest',label:'Post-Test',icon:'✅',color:T.red},
    {id:'spacedRepetition',label:'Plan de Repaso',icon:'📅',color:T.purple},
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
        {sections.length===0&&<div style={{fontSize:12,color:T.muted,lineHeight:1.6}}>Añade secciones del tema y pega el texto de cada una. Cada sección genera sus propias 6 fases de aprendizaje.</div>}
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
            <Card key={sec.id||idx} style={{overflow:'hidden',border:isGen?`1px solid ${T.purple}`:undefined}}>
              {/* Section header */}
              <div onClick={()=>setOpenSec(isOpen?null:idx)}
                style={{padding:'12px 16px',cursor:'pointer',display:'flex',alignItems:'center',gap:10,background:isOpen?(hasGen?T.purpleS:T.card):T.surface}}>
                <span style={{width:10,height:10,borderRadius:'50%',background:scoreColor,flexShrink:0,border:score===null?`2px solid ${T.border}`:'none'}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:T.text}}>{sec.title}</div>
                  <div style={{fontSize:10,color:T.muted}}>
                    {hasGen?`Generado · ${sec.generated.conceptMap?.length||0} conceptos`:'Sin generar'}
                    {score!==null&&<span style={{color:scoreColor,fontWeight:700}}> · {score}%</span>}
                  </div>
                </div>
                {isGen&&<span style={{fontSize:10,color:T.purple,fontWeight:600,background:T.purpleS,padding:'2px 8px',borderRadius:10}}>⏳ {genStep}</span>}
                <button onClick={e=>{e.stopPropagation();removeSection(idx);}} style={{background:'none',border:'none',cursor:'pointer',color:T.dim,fontSize:16,padding:'0 4px'}}>×</button>
                <span style={{color:T.dim,fontSize:16,transform:isOpen?'rotate(90deg)':'none',transition:'transform 0.2s'}}>›</span>
              </div>

              {/* Expanded section content */}
              {isOpen&&(
                <div style={{borderTop:`1px solid ${T.border}`,padding:'14px 16px'}}>
                  {/* Section-level content generation */}
                  {!hasGen&&(
                    <div style={{marginBottom:(sec.subsections||[]).length?12:0}}>
                      <textarea value={sec.text||''} onChange={e=>updateSectionText(idx,e.target.value)}
                        placeholder="Pega aquí el texto de esta sección del capítulo..."
                        style={{width:'100%',minHeight:120,background:T.card,color:T.text,border:`1px solid ${T.border}`,borderRadius:8,padding:'10px 12px',fontSize:12,fontFamily:FONT,resize:'vertical',outline:'none',boxSizing:'border-box',marginBottom:10}}/>
                      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                        <button onClick={()=>generateSection(idx)} disabled={genIdx!=null||!sec.text?.trim()}
                          style={{background:genIdx===idx?T.amberS:(!sec.text?.trim()?T.card:T.purple),color:genIdx===idx?T.amberText:(!sec.text?.trim()?T.dim:'#fff'),border:'none',borderRadius:8,padding:'8px 20px',fontSize:12,fontWeight:600,cursor:genIdx!=null||!sec.text?.trim()?'not-allowed':'pointer',fontFamily:FONT}}>
                          {genIdx===idx?`⏳ ${genStep}`:'🧠 Generar (20 pre + 25 post + 25 FC + 5 casos)'}
                        </button>
                        {sec.text?.trim()&&<span style={{fontSize:11,color:T.muted}}>{sec.text.trim().split(/\s+/).length} palabras</span>}
                      </div>
                      {genIdx===idx&&<div style={{marginTop:10}}><div style={{background:T.border,borderRadius:4,height:4}}><div style={{background:T.purple,width:`${genPct}%`,height:'100%',borderRadius:4,transition:'width 0.3s'}}/></div></div>}
                      {genError&&genIdx===idx&&<div style={{marginTop:8,fontSize:11,color:T.red}}>{genError}</div>}
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
  return(
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
        <div style={{fontSize:10,color:T.muted}}>Generado el {fmtDate(gen.generatedAt)} · {gen.conceptMap?.length||0} conceptos</div>
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
      {curPhase===2&&<FlashcardsPhase cards={gen.phases.flashcards} onDominatedChange={count=>onSaveProg('flashcardsDominated',count)}/>}
      {curPhase===3&&<ClinicalCasesPhase cases={gen.phases.clinicalCases} onScoreChange={score=>onSaveProg('clinicalScore',score)}/>}
      {curPhase===4&&(
        <div>
          <QuizPhase questions={gen.phases.postTest} title="Post-Test (25)" progress={gen.progress?.postTest} onSaveProgress={p=>onSaveProg('postTest',p)} color={T.red}/>
          {gen.progress?.preTest?.completed&&gen.progress?.postTest?.completed&&(
            <Card style={{padding:'12px 16px',marginTop:10,borderLeft:`3px solid ${T.green}`}}>
              <div style={{fontSize:11,fontWeight:600,color:T.text,marginBottom:4}}>📊 Pre vs Post</div>
              <div style={{display:'flex',gap:14,alignItems:'center'}}>
                <span style={{fontSize:16,fontWeight:700,color:T.blue}}>{gen.progress.preTest.score}%</span>
                <span style={{color:T.dim}}>→</span>
                <span style={{fontSize:16,fontWeight:700,color:T.green}}>{gen.progress.postTest.score}%</span>
                <span style={{fontSize:13,fontWeight:700,color:gen.progress.postTest.score>gen.progress.preTest.score?T.green:T.red}}>
                  {gen.progress.postTest.score>gen.progress.preTest.score?'+':''}{gen.progress.postTest.score-gen.progress.preTest.score}%
                </span>
              </div>
            </Card>
          )}
        </div>
      )}
      {curPhase===5&&data.spacedRepetition&&<SpacedRepetitionPhase schedule={data.spacedRepetition} topic={topic} learning={data} saveLearningData={saveLearningData}/>}
    </div>
  );
}

// ── Quiz Phase (Pre-Test / Post-Test) ───────────────────────────────────────
function QuizPhase({questions,title,progress,onSaveProgress,color}){
  const [current,setCurrent]=useState(0);
  const [answers,setAnswers]=useState(progress?.answers||{});
  const [showResult,setShowResult]=useState(!!progress?.completed);
  const [revealed,setRevealed]=useState({});

  if(!Array.isArray(questions)||questions.length===0) return <div style={{color:T.muted,textAlign:'center',padding:40}}>No hay preguntas disponibles.</div>;

  const total=questions.length;
  const answered=Object.keys(answers).length;
  const correct=Object.entries(answers).filter(([i,a])=>a===questions[parseInt(i)]?.correct).length;

  const finish=()=>{
    const score=Math.round(correct/total*100);
    setShowResult(true);
    onSaveProgress?.({answers,completed:true,score,correct,total});
  };

  if(showResult) return(
    <Card style={{padding:'24px',textAlign:'center'}}>
      <div style={{fontSize:48,marginBottom:12}}>{correct/total>=0.7?'🎉':correct/total>=0.5?'💪':'📚'}</div>
      <div style={{fontSize:22,fontWeight:700,color:correct/total>=0.7?T.green:correct/total>=0.5?T.amber:T.red}}>{Math.round(correct/total*100)}%</div>
      <div style={{fontSize:14,color:T.text,marginBottom:8}}>{correct} de {total} correctas</div>
      <div style={{fontSize:12,color:T.muted,marginBottom:16}}>{title}</div>
      <button onClick={()=>{setAnswers({});setShowResult(false);setCurrent(0);setRevealed({});onSaveProgress?.(null);}} style={{background:T.card,border:`1px solid ${T.border2}`,borderRadius:7,padding:'8px 18px',fontSize:12,cursor:'pointer',color:T.muted,fontFamily:FONT}}>🔄 Repetir</button>
    </Card>
  );

  const q=questions[current];
  if(!q)return null;
  const isRevealed=revealed[current];

  return(
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <span style={{fontSize:13,fontWeight:600,color:T.text}}>{title} — Pregunta {current+1}/{total}</span>
        <span style={{fontSize:12,color:T.muted}}>{answered}/{total} respondidas</span>
      </div>
      <PBar pct={answered/total*100} color={color||T.blue}/>
      <Card style={{padding:'20px',marginTop:12}}>
        <div style={{fontSize:13,color:T.text,lineHeight:1.7,marginBottom:16,fontWeight:500}}>{q.question}</div>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {(q.options||[]).map((opt,j)=>{
            const isSelected=answers[current]===j;
            const isCorrect=j===q.correct;
            const showFb=isRevealed;
            let bg=T.card,border=T.border,col=T.text;
            if(showFb&&isCorrect){bg=T.greenS;border=T.green;col=T.greenText;}
            else if(showFb&&isSelected&&!isCorrect){bg=T.redS;border=T.red;col=T.redText;}
            else if(isSelected){bg=T.blueS;border=T.blue;col=T.blueText;}
            return(
              <button key={j} onClick={()=>{if(!isRevealed){setAnswers(prev=>({...prev,[current]:j}));setRevealed(prev=>({...prev,[current]:true}));}}}
                disabled={isRevealed} style={{background:bg,border:`1px solid ${border}`,borderRadius:8,padding:'10px 14px',fontSize:12,textAlign:'left',cursor:isRevealed?'default':'pointer',color:col,fontFamily:FONT,transition:'all 0.15s'}}>
                {opt}
              </button>
            );
          })}
        </div>
        {isRevealed&&q.explanation&&(
          <div style={{marginTop:12,padding:'10px 14px',background:T.blueS,borderRadius:8,fontSize:12,color:T.blueText,lineHeight:1.6,borderLeft:`3px solid ${T.blue}`}}>
            💡 {q.explanation}
          </div>
        )}
        <div style={{display:'flex',justifyContent:'space-between',marginTop:16}}>
          <button onClick={()=>setCurrent(Math.max(0,current-1))} disabled={current===0}
            style={{background:'none',border:`1px solid ${T.border}`,borderRadius:6,padding:'6px 14px',fontSize:12,cursor:current===0?'not-allowed':'pointer',color:T.muted,fontFamily:FONT}}>← Anterior</button>
          {current===total-1&&answered>=total?(
            <button onClick={finish} style={{background:color||T.blue,color:'#fff',border:'none',borderRadius:6,padding:'6px 18px',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:FONT}}>Ver resultado</button>
          ):(
            <button onClick={()=>setCurrent(Math.min(total-1,current+1))}
              style={{background:'none',border:`1px solid ${T.border}`,borderRadius:6,padding:'6px 14px',fontSize:12,cursor:'pointer',color:T.muted,fontFamily:FONT}}>Siguiente →</button>
          )}
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
                  <div style={{background:T.amberS,border:`1px solid #fde68a`,borderRadius:8,padding:'12px 14px'}}>
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
function FlashcardsPhase({cards,onDominatedChange}){
  const [current,setCurrent]=useState(0);
  const [flipped,setFlipped]=useState(false);
  const [known,setKnown]=useState(new Set());

  if(!Array.isArray(cards)||cards.length===0) return <div style={{color:T.muted,textAlign:'center',padding:40}}>No hay flashcards disponibles.</div>;

  const card=cards[current];

  return(
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <span style={{fontSize:13,fontWeight:600,color:T.text}}>🃏 Flashcards — {current+1}/{cards.length}</span>
        <span style={{fontSize:12,color:T.green,fontWeight:600}}>{known.size} dominadas · {cards.length-known.size} restantes</span>
      </div>
      <PBar pct={known.size/cards.length*100} color={T.green}/>
      <div onClick={()=>setFlipped(!flipped)}
        style={{background:flipped?T.tealS:T.surface,border:`1px solid ${flipped?T.teal:T.border}`,borderRadius:14,padding:'40px 30px',marginTop:14,cursor:'pointer',textAlign:'center',minHeight:160,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',boxShadow:sh.md,transition:'all 0.2s'}}>
        <div style={{fontSize:10,color:T.muted,marginBottom:8,fontWeight:600,textTransform:'uppercase',letterSpacing:0.5}}>{flipped?'Respuesta':'Pregunta'} — clic para girar</div>
        <div style={{fontSize:15,color:flipped?T.tealText:T.text,fontWeight:600,lineHeight:1.6,maxWidth:500}}>{flipped?(card.back||'—'):(card.front||'—')}</div>
      </div>
      <div style={{display:'flex',justifyContent:'center',gap:10,marginTop:16}}>
        <button onClick={()=>{setCurrent(Math.max(0,current-1));setFlipped(false);}} disabled={current===0}
          style={{background:'none',border:`1px solid ${T.border}`,borderRadius:8,padding:'8px 16px',fontSize:12,cursor:current===0?'not-allowed':'pointer',color:T.muted,fontFamily:FONT}}>← Anterior</button>
        <button onClick={()=>{setKnown(prev=>{const n=new Set(prev);n.has(current)?n.delete(current):n.add(current);onDominatedChange?.(n.size);return n;});}}
          style={{background:known.has(current)?T.greenS:T.card,border:`1px solid ${known.has(current)?T.green:T.border}`,borderRadius:8,padding:'8px 16px',fontSize:12,cursor:'pointer',color:known.has(current)?T.green:T.muted,fontWeight:600,fontFamily:FONT}}>
          {known.has(current)?'✅ Dominada':'Marcar dominada'}
        </button>
        <button onClick={()=>{setCurrent(Math.min(cards.length-1,current+1));setFlipped(false);}} disabled={current===cards.length-1}
          style={{background:'none',border:`1px solid ${T.border}`,borderRadius:8,padding:'8px 16px',fontSize:12,cursor:current===cards.length-1?'not-allowed':'pointer',color:T.muted,fontFamily:FONT}}>Siguiente →</button>
      </div>
    </div>
  );
}

// ── Clinical Cases Phase ────────────────────────────────────────────────────
function ClinicalCasesPhase({cases,onScoreChange}){
  const [currentCase,setCurrentCase]=useState(0);
  const [selectedOpt,setSelectedOpt]=useState({});
  const [revealed,setRevealed]=useState({});

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

// ── Spaced Repetition Phase ─────────────────────────────────────────────────
function SpacedRepetitionPhase({schedule,topic,learning,saveLearningData}){
  if(!schedule)return <div style={{color:T.muted,textAlign:'center',padding:40}}>No hay plan de repaso.</div>;

  const today=new Date().toISOString().slice(0,10);

  const toggleCompleted=async(label)=>{
    const updated={
      ...learning,
      spacedRepetition:{
        ...learning.spacedRepetition,
        reviews:{
          ...learning.spacedRepetition.reviews,
          [label]:{...learning.spacedRepetition.reviews[label],completed:!learning.spacedRepetition.reviews[label].completed}
        }
      }
    };
    await saveLearningData(topic,updated);
  };

  const reviewEntries=Object.entries(schedule.reviews||{}).sort((a,b)=>a[1].date.localeCompare(b[1].date));
  const completed=reviewEntries.filter(([,r])=>r.completed).length;

  return(
    <div>
      <Card style={{padding:'20px',marginBottom:16}}>
        <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:6}}>📅 Plan de Repaso Espaciado</div>
        <div style={{fontSize:12,color:T.muted,marginBottom:8}}>Inicio: {fmtDate(schedule.startDate)} · {completed}/{reviewEntries.length} completados</div>
        <PBar pct={reviewEntries.length?completed/reviewEntries.length*100:0} color={T.purple}/>
      </Card>

      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {reviewEntries.map(([label,rev])=>{
          const isPast=rev.date<=today;
          const isDue=isPast&&!rev.completed;
          const isCompleted=rev.completed;
          return(
            <Card key={label} style={{padding:'14px 18px',borderLeft:`3px solid ${isCompleted?T.green:isDue?T.purple:T.border}`}}>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <button onClick={()=>toggleCompleted(label)}
                  style={{width:28,height:28,borderRadius:'50%',background:isCompleted?T.green:T.card,border:`2px solid ${isCompleted?T.green:isDue?T.purple:T.border}`,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,color:'#fff',flexShrink:0}}>
                  {isCompleted?'✓':''}
                </button>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:isCompleted?T.green:isDue?T.purple:T.text}}>{label}</div>
                  <div style={{fontSize:11,color:T.muted}}>{fmtDate(rev.date)}</div>
                </div>
                {isDue&&<span style={{fontSize:11,color:T.purple,fontWeight:600,background:T.purpleS,padding:'3px 10px',borderRadius:20}}>⏰ Pendiente</span>}
                {isCompleted&&<span style={{fontSize:11,color:T.green,fontWeight:600}}>✅ Completado</span>}
                {!isPast&&!isCompleted&&<span style={{fontSize:11,color:T.dim}}>Próximamente</span>}
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
        {testQs.length===0&&<p style={{color:T.amber,marginTop:10,fontSize:12}}>⚠️ Genera preguntas en el Banco primero.</p>}
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
          {cfg.timer>0&&<span style={{background:timeLeft<=10?T.redS:T.blueS,color:timeLeft<=10?T.red:T.blue,border:`1px solid ${timeLeft<=10?'#fca5a5':'#93c5fd'}`,padding:'3px 10px',borderRadius:6,fontWeight:700,fontSize:13,transition:'all 0.3s'}}>⏱ {timeLeft}s</span>}
        </div>
        <button onClick={()=>toggleMark(q.id)} style={{background:'none',border:'none',cursor:'pointer',fontSize:18,color:marked.has(q.id)?T.amber:T.dim}}>{marked.has(q.id)?'🔖':'🏷️'}</button>
      </div>
      <div style={{background:T.border,borderRadius:4,height:5,marginBottom:20}}><div style={{background:`linear-gradient(90deg,${T.blue},${T.teal})`,width:`${(idx/session.length)*100}%`,height:'100%',borderRadius:4,transition:'width 0.3s'}}/></div>
      <span style={{fontSize:11,background:T.blueS,color:T.blueText,padding:'3px 10px',borderRadius:20,fontWeight:600}}>{q.topic}</span>
      <div style={{margin:'14px 0',fontSize:16,fontWeight:500,color:T.text,lineHeight:1.75}}>{q.question}</div>
      <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
        {q.options.map((opt,i)=>{
          let bg=T.surface,border=T.border,color=T.text,bl='3px solid transparent';
          if(revealed){if(i===q.correct){bg=T.greenS;border='#86efac';color=T.greenText;bl=`3px solid ${T.green}`;}else if(i===selected&&i!==q.correct){bg=T.redS;border='#fca5a5';color=T.redText;bl=`3px solid ${T.red}`;}}
          else if(selected===i){bg=T.blueS;border='#93c5fd';color=T.blueText;bl=`3px solid ${T.blue}`;}
          return <button key={i} onClick={()=>!revealed&&handleReveal(i,session,idx)} disabled={revealed} style={{display:'flex',alignItems:'flex-start',gap:12,padding:'12px 16px',background:bg,border:`1px solid ${border}`,borderLeft:bl,borderRadius:8,cursor:revealed?'default':'pointer',color,textAlign:'left',fontSize:13,lineHeight:1.5,fontFamily:FONT,transition:'all 0.15s',boxShadow:sh.sm}}>
            <span style={{fontWeight:700,minWidth:20,color:revealed&&i===q.correct?T.green:T.dim}}>{OPT[i]}</span>
            <span style={{flex:1}}>{opt}</span>
            {revealed&&i===q.correct&&<span>✅</span>}
            {revealed&&i===selected&&i!==q.correct&&<span>❌</span>}
          </button>;
        })}
      </div>
      {revealed&&q.explanation&&<div style={{background:T.blueS,border:'1px solid #93c5fd',borderLeft:`3px solid ${T.blue}`,borderRadius:8,padding:'12px 16px',marginBottom:16,fontSize:13,color:T.blueText,lineHeight:1.6}}><strong>💡 </strong>{q.explanation}</div>}
      {revealed&&<Btn onClick={()=>{setAnswers(prev=>[...prev,{selected,correct:q.correct}]);if(idx+1>=session.length)setPhase('results');else{setIdx(i=>i+1);setSelected(null);setRevealed(false);}}}>{idx+1>=session.length?'Ver resultados →':'Siguiente →'}</Btn>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SIMULACRO  ⚡ — examen real con penalización
// ═══════════════════════════════════════════════════════════════════════════
function Simulacro({testQs,recordAnswer,addSession}){
  const [phase,setPhase]=useState('setup');
  const [cfg,setCfg]=useState({section:'all',n:100,totalTime:120,penalty:'tercio'});
  const [session,setSession]=useState([]);
  const [answers,setAnswers]=useState([]); // null=blank, 0-3=selected
  const [current,setCurrent]=useState(0);
  const [markedQ,setMarkedQ]=useState(new Set());
  const [timeLeft,setTimeLeft]=useState(0);
  const [startTs,setStartTs]=useState(0);
  const [results,setResults]=useState(null);
  const timerRef=useRef(null);
  const submitRef=useRef(null);

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
    setResults(r);
    addSession({mode:'simulacro',topics:[...new Set(sess.map(q=>q.topic))],n:sess.length,...r,duration:Math.round((Date.now()-startTs)/1000)});
    setPhase('results');
  },[recordAnswer,addSession,startTs]);

  useEffect(()=>{submitRef.current={handleSubmit,answers,session,cfg};},[handleSubmit,answers,session,cfg]);

  useEffect(()=>{
    if(phase!=='running')return;
    timerRef.current=setInterval(()=>{
      setTimeLeft(t=>{
        if(t<=1){clearInterval(timerRef.current);const{handleSubmit:hs,answers:a,session:s,cfg:c}=submitRef.current;hs(a,s,c);return 0;}
        return t-1;
      });
    },1000);
    return()=>clearInterval(timerRef.current);
  },[phase]);

  const start=()=>{
    let pool=testQs;
    if(cfg.section!=='all'){const topics=SECTIONS.find(s=>s.id===cfg.section)?.topics;if(topics)pool=pool.filter(q=>topics.includes(q.topic));}
    if(!pool.length)return alert('No hay preguntas. Genera primero en el Banco.');
    const s=shuffle(pool).slice(0,Math.min(cfg.n,pool.length));
    setSession(s);setAnswers(new Array(s.length).fill(null));setCurrent(0);setMarkedQ(new Set());setTimeLeft(cfg.totalTime*60);setStartTs(Date.now());setPhase('running');
  };

  const selectAnswer=(i)=>{
    setAnswers(prev=>{const a=[...prev];a[current]=a[current]===i?null:i;return a;});
  };

  const toggleMarkQ=(i)=>{setMarkedQ(prev=>{const m=new Set(prev);m.has(i)?m.delete(i):m.add(i);return m;})};

  // ── Setup ──
  if(phase==='setup') return(
    <div style={{maxWidth:680}}>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:24}}>
        <div style={{width:40,height:40,borderRadius:10,background:T.orangeS,border:`2px solid ${T.orange}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20}}>⚡</div>
        <div><h2 style={{fontSize:18,fontWeight:700,margin:0,color:T.text,letterSpacing:-0.3}}>Simulacro de examen</h2><p style={{color:T.muted,fontSize:13,margin:0}}>Condiciones reales: tiempo total, sin feedback inmediato, penalización por error</p></div>
      </div>
      <Lbl>Bloque temático</Lbl>
      <Sel value={cfg.section} onChange={v=>setCfg({...cfg,section:v})}>
        <option value="all">Temario completo — todos los bloques ({testQs.length} preg. disponibles)</option>
        {SECTIONS.map(s=>{const n=testQs.filter(q=>s.topics.includes(q.topic)).length;return n>0?<option key={s.id} value={s.id}>{s.emoji} {s.name} ({n})</option>:null;})}
      </Sel>
      <Lbl>Número de preguntas</Lbl>
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
        {[25,50,75,100].map(n=><button key={n} onClick={()=>setCfg({...cfg,n})} style={{padding:'7px 18px',borderRadius:7,fontWeight:600,fontSize:13,cursor:'pointer',background:cfg.n===n?T.orange:T.surface,border:`1px solid ${cfg.n===n?T.orange:T.border}`,color:cfg.n===n?'#fff':T.muted,boxShadow:sh.sm,fontFamily:FONT}}>{n}</button>)}
      </div>
      <Lbl>Tiempo total del examen</Lbl>
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
        {[60,90,120,150,180].map(t=><button key={t} onClick={()=>setCfg({...cfg,totalTime:t})} style={{padding:'7px 16px',borderRadius:7,fontWeight:600,fontSize:13,cursor:'pointer',background:cfg.totalTime===t?T.orange:T.surface,border:`1px solid ${cfg.totalTime===t?T.orange:T.border}`,color:cfg.totalTime===t?'#fff':T.muted,boxShadow:sh.sm,fontFamily:FONT}}>{t} min</button>)}
      </div>
      <Lbl>Sistema de puntuación</Lbl>
      <RadioGroup value={cfg.penalty} onChange={v=>setCfg({...cfg,penalty:v})} options={[{value:'tercio',label:'✅ +1 acierto · ❌ −1/3 error · ⬜ 0 en blanco (OPE estándar SESCAM)'},{value:'cuarto',label:'✅ +1 acierto · ❌ −1/4 error · ⬜ 0 en blanco'},{value:'ninguna',label:'✅ +1 acierto · ❌ 0 error · sin penalización'}]}/>
      <Btn onClick={start} disabled={testQs.length<10} variant="orange" style={{marginTop:4}}>⚡ Comenzar simulacro →</Btn>
      {testQs.length<10&&<p style={{color:T.amber,marginTop:10,fontSize:12}}>⚠️ Necesitas al menos 10 preguntas test en el Banco.</p>}
    </div>
  );

  // ── Results ──
  if(phase==='results'&&results) return(
    <div>
      <Card style={{padding:'28px 32px',marginBottom:20,textAlign:'center'}}>
        <div style={{fontSize:11,fontWeight:700,color:T.orange,letterSpacing:1.5,textTransform:'uppercase',marginBottom:12}}>Resultado del simulacro</div>
        <div style={{display:'flex',justifyContent:'center',gap:32,marginBottom:20,flexWrap:'wrap'}}>
          <div><div style={{fontSize:42,fontWeight:800,color:results.pct>=70?T.green:results.pct>=50?T.amber:T.red,lineHeight:1,letterSpacing:-2}}>{results.pct}%</div><div style={{fontSize:12,color:T.muted,marginTop:4}}>Nota</div></div>
          <div style={{borderLeft:`1px solid ${T.border}`,paddingLeft:32}}><div style={{fontSize:28,fontWeight:700,color:T.greenDk}}>{results.correct}</div><div style={{fontSize:12,color:T.muted}}>Correctas</div></div>
          <div><div style={{fontSize:28,fontWeight:700,color:T.red}}>{results.wrong}</div><div style={{fontSize:12,color:T.muted}}>Erróneas</div></div>
          <div><div style={{fontSize:28,fontWeight:700,color:T.dim}}>{results.blank}</div><div style={{fontSize:12,color:T.muted}}>En blanco</div></div>
        </div>
        <div style={{background:results.pct>=70?T.greenS:results.pct>=50?T.amberS:T.redS,border:`1px solid ${results.pct>=70?'#86efac':results.pct>=50?'#fde68a':'#fca5a5'}`,borderRadius:8,padding:'10px 16px',display:'inline-block',marginBottom:16}}>
          <span style={{fontSize:14,fontWeight:600,color:results.pct>=70?T.greenText:results.pct>=50?T.amberText:T.redText}}>
            Puntuación: <strong>{results.score.toFixed(2)}</strong> / {results.maxScore} puntos
          </span>
        </div>
        <div style={{fontSize:12,color:T.dim,marginBottom:4}}>
          Fórmula: {results.correct} − {results.wrong} × {cfg.penalty==='tercio'?'1/3':cfg.penalty==='cuarto'?'1/4':'0'} = {results.score.toFixed(2)} puntos
        </div>
        <div style={{fontSize:12,color:T.muted}}>
          {results.pct>=70?'✅ Superarías el examen si el umbral es el 70%':'❌ Por debajo del umbral de aprobado (70%)'}
        </div>
      </Card>
      <div style={{display:'flex',gap:10,justifyContent:'center',marginBottom:24}}>
        <Btn onClick={()=>{setPhase('setup');setResults(null);}} variant="orange">Nuevo simulacro</Btn>
        <Btn variant="ghost" onClick={()=>{
          const[detail,setDetail]=useState(false);
        }}>Revisar respuestas</Btn>
      </div>
      {/* Review */}
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {session.map((q,i)=>{
          const a=answers[i];const ok=a===q.correct;const blank=a===null;
          return <Card key={q.id} style={{padding:'10px 14px',borderLeft:`3px solid ${blank?T.dim:ok?T.green:T.red}`}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
              <div style={{flex:1}}>
                <div style={{marginBottom:4,display:'flex',gap:6}}><span style={{fontSize:10,background:T.blueS,color:T.blueText,padding:'2px 8px',borderRadius:20,fontWeight:600}}>{q.topic}</span></div>
                <p style={{margin:'4px 0 5px',fontSize:13,color:T.text,lineHeight:1.5}}>{q.question}</p>
                <p style={{margin:0,fontSize:12,color:blank?T.dim:ok?T.greenDk:T.redDk}}>{blank?'⬜ En blanco':ok?'✅':' ❌'} {blank?'':q.options[q.correct]}{!blank&&!ok&&a!=null?<span style={{color:T.muted}}> · Tuya: {q.options[a]}</span>:''}</p>
                {q.explanation&&<p style={{margin:'4px 0 0',fontSize:11,color:T.muted,fontStyle:'italic'}}>{q.explanation}</p>}
              </div>
              <span style={{fontSize:11,fontWeight:700,color:blank?T.dim:ok?T.greenDk:T.redDk,flexShrink:0}}>{blank?'0':ok?'+1':`-${cfg.penalty==='tercio'?'0.33':cfg.penalty==='cuarto'?'0.25':'0'}`}</span>
            </div>
          </Card>;
        })}
      </div>
    </div>
  );

  // ── Running ──
  const q=session[current];if(!q)return null;
  const OPT=['A','B','C','D'];
  const answered=answers.filter(a=>a!==null).length;
  const timeColor=timeLeft<300?T.red:timeLeft<600?T.amber:T.teal;

  return(
    <div>
      {/* Top bar */}
      <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'12px 18px',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between',boxShadow:sh.sm,flexWrap:'wrap',gap:8}}>
        <div style={{display:'flex',alignItems:'center',gap:16}}>
          <div style={{textAlign:'center'}}>
            <div style={{fontSize:22,fontWeight:800,color:timeColor,fontVariantNumeric:'tabular-nums',letterSpacing:1}}>{fmtTime(timeLeft)}</div>
            <div style={{fontSize:10,color:T.dim,marginTop:-2}}>tiempo restante</div>
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
      {fcQs.length===0&&<p style={{color:T.amber,marginTop:10,fontSize:12}}>⚠️ Genera flashcards en el Banco primero.</p>}
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
            {[{q:0,l:'De nuevo',c:T.red,sub:'<1d',bg:T.redS,b:'#fca5a5'},{q:2,l:'Difícil',c:T.amber,sub:'~1d',bg:T.amberS,b:'#fde68a'},{q:4,l:'Bien',c:T.blue,sub:`~${srInfo.interval||1}d`,bg:T.blueS,b:'#93c5fd'},{q:5,l:'Fácil',c:T.green,sub:'más días',bg:T.greenS,b:'#86efac'}].map(r=>(
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
    setMsg(`✅ ${withIds.length} preguntas importadas al banco.`);
    setPreview(null);setFile(null);
  };

  const nullCount=preview?.filter(q=>q.correct===null).length||0;

  return(
    <div style={{maxWidth:800}}>
      <h3 style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:6}}>📄 Importar examen oficial PDF</h3>
      <p style={{color:T.muted,fontSize:13,marginBottom:20,lineHeight:1.6}}>Sube un PDF de examen oficial. La IA extrae todas las preguntas automáticamente en lotes y las añade al banco con el tema asignado.</p>

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

      {msg&&<div style={{marginTop:12,fontSize:13,color:msg.startsWith('❌')?T.red:msg.startsWith('✅')?T.green:T.muted,padding:'8px 12px',background:msg.startsWith('❌')?T.redS:msg.startsWith('✅')?T.greenS:T.card,borderRadius:8,border:`1px solid ${msg.startsWith('❌')?'#fca5a5':msg.startsWith('✅')?'#86efac':T.border}`}}>{msg}</div>}

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
          {nullCount>0&&<div style={{background:T.amberS,border:`1px solid ${T.amber}`,borderRadius:8,padding:'8px 12px',fontSize:12,color:T.amberText,marginBottom:12}}>⚠️ Sin solucionario en el PDF. Las preguntas se importan con opción A por defecto — corrígelas en el banco.</div>}
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
    const a=document.createElement('a');a.href=url;a.download=`banco_opelab_${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);
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
                return <label key={t} style={{display:'flex',alignItems:'flex-start',gap:8,cursor:'pointer',padding:'7px 10px',borderRadius:7,background:aiTopic===t?T.blueS:'transparent',border:`1px solid ${aiTopic===t?T.blue:hasPdfAttached?'#86efac':T.border}`}}>
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
            <div style={{background:T.greenS,border:'1px solid #86efac',borderLeft:`3px solid ${T.green}`,borderRadius:8,padding:'10px 14px',marginBottom:10}}>
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
                  <label key={f.id} style={{display:'flex',alignItems:'center',gap:8,background:sel?'#bbf7d0':T.card,borderRadius:6,padding:'5px 8px',marginBottom:3,cursor:'pointer',border:`1px solid ${sel?'#86efac':T.border}`,transition:'all 0.15s'}}>
                    <input type="checkbox" checked={sel} onChange={()=>togglePdfId(f.id)} style={{accentColor:T.green,flexShrink:0}}/>
                    <span style={{fontSize:11,color:sel?T.greenText:T.muted,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:sel?600:400}}>📄 {f.name}</span>
                    <span style={{fontSize:10,color:T.dim,flexShrink:0}}>{mb} MB</span>
                  </label>
                );
              })}
              {selectedFiles.length===0&&<div style={{fontSize:11,color:T.amber,marginTop:4,padding:'4px 8px',background:'#fef9c3',borderRadius:5}}>⚠️ Ningún PDF seleccionado — se generará sin fuente del libro</div>}
              {selectedFiles.length>0&&<div style={{fontSize:11,color:T.greenText,marginTop:6,fontWeight:600}}>{selectedFiles.length} PDF{selectedFiles.length>1?'s':''} · {selectedFiles.reduce((a,f)=>a+f.size,0)>200000000?<span style={{color:T.red}}>⚠️ Puede superar el límite</span>:`${(selectedFiles.reduce((a,f)=>a+f.size,0)/1024/1024).toFixed(1)} MB total`}</div>}
              <button onClick={()=>fileRef.current?.click()} style={{marginTop:6,fontSize:10,background:'none',border:`1px solid ${T.border2}`,borderRadius:5,padding:'3px 9px',cursor:'pointer',color:T.muted,fontFamily:FONT}}>+ Añadir otro PDF</button>
            </div>
          )}
          {pdfFile&&(
            <div style={{background:T.blueS,border:'1px solid #93c5fd',borderLeft:`3px solid ${T.blue}`,borderRadius:8,padding:'10px 14px',marginBottom:10,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
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
          {aiMsg&&<div style={{marginTop:12,padding:'10px 14px',borderRadius:8,fontSize:13,lineHeight:1.5,background:aiMsg.startsWith('✅')?T.greenS:aiMsg.startsWith('❌')?T.redS:T.card,color:aiMsg.startsWith('✅')?T.greenText:aiMsg.startsWith('❌')?T.redText:T.muted,border:`1px solid ${aiMsg.startsWith('✅')?'#86efac':aiMsg.startsWith('❌')?'#fca5a5':T.border}`,borderLeft:`3px solid ${aiMsg.startsWith('✅')?T.green:aiMsg.startsWith('❌')?T.red:T.border2}`}}>{aiMsg}</div>}
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
            {qs.length>0&&<><button onClick={exportJSON} style={{background:T.blueS,color:T.blue,border:'1px solid #93c5fd',borderRadius:7,padding:'6px 12px',fontSize:12,cursor:'pointer',fontFamily:FONT,fontWeight:600}}>⬇️ Exportar JSON</button><button onClick={async()=>{if(confirm(`¿Borrar TODAS las ${qs.length} preguntas?`)){await idbClearQs();setQs([]);}}} style={{background:T.redS,color:T.red,border:'1px solid #fca5a5',borderRadius:7,padding:'6px 12px',fontSize:12,cursor:'pointer',fontFamily:FONT}}>🗑 Borrar todo</button></>}
          </div>
          {filtered.length===0?<Card style={{padding:'50px',textAlign:'center'}}><div style={{fontSize:36,marginBottom:8}}>📭</div><div style={{color:T.dim}}>{qs.length===0?'Banco vacío. Genera preguntas con IA.':'Sin preguntas para este filtro.'}</div></Card>:<div style={{display:'flex',flexDirection:'column',gap:8}}>
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
          <h3 style={{color:T.text,fontSize:16,fontWeight:600,marginBottom:4}}>📤 Importar banco JSON</h3>
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
            <div style={{textAlign:'center',background:daysLeft<30?T.redS:daysLeft<90?T.amberS:T.blueS,border:`1px solid ${daysLeft<30?'#fca5a5':daysLeft<90?'#fde68a':'#93c5fd'}`,borderRadius:12,padding:'16px 24px'}}>
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
