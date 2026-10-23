# Agulha

**Do PDF do Corel ao ficheiro de bordado, sem digitalizar à mão.**

A Agulha converte um logótipo vetorial (PDF exportado do CorelDRAW, Illustrator, etc.) num ficheiro de bordado **DST** para máquinas Tajima. Funciona no navegador, não é preciso instalar nada e os ficheiros nunca saem do computador.

👉 **Usar:** https://fcarmo84.github.io/agulha/

## Para quem é

Para quem domina o Corel mas perde horas no software de bordado a acertar pontos e direções em trabalhos simples (nomes, logótipos de uma cor, texto). A Agulha faz a parte difícil; no fim basta abrir o DST no programa da máquina (por exemplo o Tajima DG/ML by Pulse) e **Guardar como** TCF ou o formato que a máquina usa.

## Como usar

1. No Corel, converta o texto em curvas (**Ctrl+Q**) e exporte em **PDF**.
2. Arraste o PDF para a página.
3. Escolha a largura em mm e o tipo de tecido.
4. Veja a simulação, as direções do ponto e o percurso da agulha.
5. Descarregue o DST. Teste sempre num retalho antes de produzir.

## O que faz automaticamente

- **Direções do ponto:** cada letra é dividida em partes (pernas, diagonais, curvas) e cada parte recebe o ponto atravessado ao traço.
- **Tipo de ponto:** cetim nas partes estreitas, tatami (enchimento) nas largas; cetim dividido acima de 6 mm.
- **Durabilidade:** nenhum ponto acima de 7 mm, ponto de base (underlay), compensação de repuxo e remates.
- **Menos cortes:** liga as partes da mesma letra por baixo do bordado; só corta a linha entre letras (sequência de 3 saltos, como os programas Tajima).
- **Cores:** cada cor de preenchimento do PDF é bordada por ordem, com troca de cor no DST.

## Limitações atuais

- Só formas **preenchidas**; contornos sem preenchimento e imagens (bitmap) são ignorados.
- Lê a primeira página do PDF.
- Logótipos com várias cores sobrepostas ainda não fazem remoção de sobreposições.
- Traços com menos de 0,8 mm de largura são difíceis de bordar em qualquer programa.

## Como funciona (para quem quer contribuir)

Tudo em JavaScript, sem dependências nem compilação:

| Ficheiro | O que faz |
|---|---|
| `js/vetor.js` | Leitor de PDF próprio (objetos, streams Flate, operadores de caminho) e de SVG |
| `js/motor.js` | Digitalização: cordas por ângulo → núcleos de direção → partes → cetim/tatami/base → sequência e ligações (Dijkstra por dentro da letra) |
| `js/dst.js` | Escrita/leitura de Tajima DST |
| `js/visual.js` | Simulação do bordado, mapa de direções, percurso |

Para correr localmente: `python3 -m http.server` na pasta e abrir `http://localhost:8000`.

Sugestões e problemas: abra uma *issue* com o PDF (se puder partilhar) e uma foto do resultado bordado.

## Licença

MIT
