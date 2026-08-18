# Protótipos

Código exploratório. **Não faz parte do build** — nada em `garment-algorithm/`
importa daqui.

## `garment-algorithm-inchat.jsx`

Versão de arquivo único (React, sem build, sem credenciais) feita para rodar
dentro do chat. Diferença central em relação ao app: em vez de segmentação por
modelo, a seleção da peça é feita por **varinha mágica** (flood fill por
similaridade de cor) mais pincel de refino. O efeito ASCII Reconstruction e a
regra de recorte na máscara são os mesmos.

Serve como referência para: seleção manual rápida quando não há token de
segmentação, e como fallback de UX.
