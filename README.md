# OPE Lab — FEA Laboratorio Clínico SESCAM 2025

Plataforma de estudio para la oposición FEA de Laboratorio Clínico.
Temario oficial SESCAM 2025 · Referencias Tietz 7ª ed. y Henry 23ª ed.

---

## Opción A — Uso local

### Requisitos
- Node.js 18+ → https://nodejs.org (LTS)
- API key de Anthropic → https://console.anthropic.com

```bash
cd opelab
npm install
cp .env.example .env.local
# Edita .env.local y añade tu ANTHROPIC_API_KEY
npm run dev
# → http://localhost:5173
```

---

## Opción B — Vercel (URL pública)

### 1. Sube a GitHub
```bash
git init && git add . && git commit -m "OPE Lab"
# Crea repo en github.com y sigue las instrucciones de push
```

### 2. Despliega en Vercel
1. vercel.com → Add New Project → selecciona tu repo
2. Framework: Vite · Build: npm run build · Output: dist
3. Deploy

### 3. Añade la API key
Vercel dashboard → Settings → Environment Variables:
- Name: ANTHROPIC_API_KEY
- Value: sk-ant-api03-...
- Environments: Production + Preview + Development

Redeploy → listo.

### Actualizar
```bash
git add . && git commit -m "cambio" && git push
# Vercel despliega automáticamente
```

---

## Arquitectura
- api/anthropic.js — función serverless (la API key nunca sale al navegador)
- src/App.jsx — aplicación React completa
- vite.config.js — proxy local para desarrollo

## Coste API
~0.003€ por generación de 10 preguntas
