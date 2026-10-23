# Agulha

**Do PDF do Corel ao ficheiro de bordado, sem digitalizar à mão.**

A Agulha converte um logótipo vetorial (PDF exportado do CorelDRAW, Illustrator, etc.) num ficheiro de bordado **DST** para máquinas Tajima. Funciona no navegador, não é preciso instalar nada e os ficheiros nunca saem do computador.

👉 **Usar:** https://fcarmo84.github.io/agulha/

## Para quem é

Para quem domina o Corel mas perde horas no software de bordado a acertar pontos e direções em trabalhos simples (nomes, logótipos de uma cor, texto). A Agulha faz a parte difícil; no fim basta abrir o DST no programa da máquina (por exemplo o Tajima DG/ML by Pulse) e **Guardar como** TCF ou o formato que a máquina usa.

## Como usar

1. No Corel, converta o texto em curvas (**Ctrl+Q**) e exporte em **PDF**. No Illustrator: **Texto → Criar contornos** (Ctrl+Shift+O), **Objeto → Expandir** nos traços, e **Guardar como → Adobe PDF**.
2. Arraste o PDF para a página.
3. Escolha a largura em mm e o tipo de tecido.
4. Veja a simulação, as direções do ponto e o percurso da agulha.
5. Descarregue o DST. Teste sempre num retalho antes de produzir.

## O que faz automaticamente

- **Cetim rotativo nas curvas:** em traços curvos sem cruzamentos (S, C, O, D pequenos…) o ponto acompanha a curva; a densidade é medida pelo lado de fora e o lado de dentro leva pontos curtos alternados.
- **Direções do ponto:** letras com pernas e cruzamentos (N, E, A…) são divididas em partes, cada uma com o ponto atravessado ao traço.
- **Tipo de ponto:** cetim nas partes estreitas, tatami (enchimento) nas largas; cetim dividido acima de 6 mm.
- **Durabilidade:** nenhum ponto acima de 7 mm, ponto de base (underlay), compensação de repuxo e remates.
- **Menos cortes:** liga as partes da mesma letra por baixo do bordado; só corta a linha entre letras (sequência de 3 saltos, como os programas Tajima).
- **Várias cores (até 4 ou mais):** cada cor de preenchimento é uma linha; tons quase iguais juntam-se. Onde uma cor tapa outra, a de baixo é recortada (fica 0,35 mm de margem por baixo para não abrir fendas). A ordem de bordado muda-se na página e cada cor pode ser desligada (fica à vista do tecido). O DST leva as trocas de cor.
- **PDF do Corel e do Illustrator:** cores CMYK, RGB, ICC, Lab e cores spot (Pantone, com o nome), máscaras de recorte.
- **Enchimentos largos:** uma só direção por forma (sem costuras); o cetim acompanha os traços estreitos.

## Limitações atuais

- Só formas **preenchidas**; contornos sem preenchimento e imagens (bitmap) são ignorados.
- Lê a primeira página do PDF.
- Gradientes e transparências não se bordam (use cores sólidas).
- Traços com menos de 0,8 mm de largura são difíceis de bordar em qualquer programa.

## Como funciona (para quem quer contribuir)

Tudo em JavaScript, sem dependências nem compilação:

| Ficheiro | O que faz |
|---|---|
| `js/vetor.js` | Leitor de PDF próprio (objetos, streams Flate, operadores de caminho) e de SVG |
| `js/curvas.js` | Cetim rotativo: esqueleto → linha central → carris exatos no vetor → ziguezague com densidade constante por fora |
| `js/camadas.js` | Cores: agrupar tons, recortes, retirar o que fica tapado (raster + contornos) |
| `js/trabalho.js` | Cálculo em segundo plano (Web Worker) |
| `js/motor.js` | Digitalização: cordas por ângulo → núcleos de direção → partes → cetim/tatami/base → sequência e ligações (Dijkstra por dentro da letra) |
| `js/dst.js` | Escrita/leitura de Tajima DST |
| `js/visual.js` | Simulação do bordado, mapa de direções, percurso |

Para correr localmente: `python3 -m http.server` na pasta e abrir `http://localhost:8000`.

Sugestões e problemas: abra uma *issue* com o PDF (se puder partilhar) e uma foto do resultado bordado.

## Licença

MIT
