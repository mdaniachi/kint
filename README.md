# KINT

**▶ [Abrir a ferramenta](https://mdaniachi.github.io/kint/)**

Ferramenta criativa web: você sobe uma foto de moda, o sistema detecta as peças
de roupa, você clica em uma delas e um tratamento algorítmico é renderizado
**estritamente dentro da máscara daquela peça**. Todo pixel fora da máscara vem
direto da fotografia original.

```
UPLOAD → DETECTAR → SELECIONAR PEÇA → APLICAR EFEITO → AJUSTAR → EXPORTAR
```

## Estrutura

```
KINT/
├── garment-algorithm/    aplicação principal (Next.js 14 + TypeScript + Tailwind)
│   └── public/samples/   fotos de teste (fora do git — direitos de terceiros)
├── prototypes/           versões exploratórias, fora do build
└── .github/workflows/    deploy automático para GitHub Pages
```

| Pasta | O que é | Status |
|---|---|---|
| [`garment-algorithm/`](garment-algorithm/) | **KINT STUDIO** — app completo: segmentação via Hugging Face, máscara refinável a pincel, efeito ASCII Reconstruction, export em resolução original | fonte de verdade |
| [`prototypes/`](prototypes/) | `garment-algorithm-inchat.jsx` — protótipo de arquivo único, sem credenciais, seleção por varinha (flood fill) | referência |

## Publicação

O site é gerado e publicado sozinho: todo push na `main` dispara
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), que roda
`npm run build:static` e envia para o GitHub Pages.

```bash
npm run build:static   # gera out/ localmente, se quiser conferir antes
```

Duas coisas que essa build resolve:

- **Prefixo de caminho.** O Pages serve em `/kint`, não na raiz do domínio. O
  worker monta as URLs do modelo e do runtime a partir de
  `NEXT_PUBLIC_BASE_PATH`, senão buscaria em `/models/` e tomaria 404.
- **A rota de API.** `output: "export"` se recusa a exportar um route handler
  POST, e `app/api/segment` é exatamente isso. O script o guarda durante a
  build e devolve depois — ele não faz falta no site (a detecção roda no
  browser) mas continua no repositório para quem quiser servir num servidor.

O modelo (28 MB), o runtime ONNX (35 MB) e a biblioteca de inferência (1,2 MB)
**estão versionados** — a versão hospedada precisa servi-los do próprio
domínio. As fotos de teste não: são de terceiros e ficam fora do git.

## Rodar

```bash
cd garment-algorithm
npm install
npm run setup:model   # uma vez: baixa o modelo de deteccao (~29 MB)
npm run dev
```

Abre em http://localhost:3000. Sem conta, sem chave de API, sem `.env`.

**A detecção roda 100% local**: o modelo de parsing de roupa
(`segformer_b2_clothes`, 18 classes) executa em um Web Worker via ONNX Runtime
WebAssembly, com os pesos servidos de `public/models/` e o runtime de
`public/ort/`. Nenhuma foto sai da máquina. Se a detecção falhar, o app avisa e
você ainda pode pintar a máscara à mão (**+ Manual mask**) — ela nunca é
simulada.

Para calibrar o efeito sem pintar máscara à mão, `/dev/effect-preview` carrega
as fotos de `public/samples/`, cria a máscara por clique (varinha por
similaridade de cor) e expõe todos os parâmetros ao vivo.

Detalhes de arquitetura, parâmetros do efeito e como plugar novos provedores de
segmentação: [`garment-algorithm/README.md`](garment-algorithm/README.md).

## Pontos de extensão

- **Segmentação é uma fronteira de serviço** — a UI só chama `segmentImage()`.
  Trocar de provedor = trocar `app/api/segment/route.ts`
  (resposta: `[{ label, score, mask (png base64) }]`).
- **Efeitos são modulares** — um novo tratamento (Point Cloud, Wireframe,
  Halftone…) implementa `GarmentEffect` e se registra em `lib/effects/index.ts`.
  Recebe imagem, máscara, parâmetros, análise pré-computada e uma seed estável.
- **Duas resoluções** — interação em preview ≤1600px; export re-renderiza em
  resolução cheia com parâmetros escalados. É essa mesma divisão que um futuro
  modo vídeo usaria (análise por frame + tracking de máscara alimentando a
  mesma interface de efeito).

## Fora de escopo (por decisão de briefing)

Vídeo, contas, autenticação, banco, cobrança, gestão de projeto. A interação
criativa é o produto.
