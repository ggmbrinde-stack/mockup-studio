# Gemini upscaling — prompt research (2026-11-16)

Reference notes for the **AI image editor (Gemini in Chrome)** block in Mockup Studio
(`modules/ai-image/`, 2.5.0): the wording to paste into Gemini together with the
artwork exported by *Use selection*, and the limits that shape it.

Status: research only. Nothing here is wired into the panel yet — see
[Open decisions](#open-decisions).

---

## What the research changes about the question

Three facts first, because they decide what a "best upscale prompt" can be:

1. **Resolution is not a prompt setting.** Output size is a request field (`1K / 2K / 4K`), and the consumer Gemini app never exposes it — Google's own help says downloads are **2K with a Google AI plan (AI Plus counts), 1K without** ([Gemini Help](https://support.google.com/gemini/answer/14286560)). So "upscale to 4K", "8K", "300 DPI", "4096 px" do nothing inside the app; 4K needs the billed API (which is out of scope here). ([app-vs-API write-up](https://projedefteri.com/en/blog/gemini-4k-photo-prompt))
2. **It re-renders, it doesn't enlarge.** The model redraws the picture at the target tier, so details you don't pin down can be *reinterpreted*. Google's answer to that is the "high-fidelity detail preservation" pattern: **describe the critical details in detail and say they must stay completely unchanged** ([API docs](https://ai.google.dev/gemini-api/docs/image-generation)).
3. **Google frames upscaling exactly that way** — DeepMind's Pro page has an "Upscale with precision / 1k, 2k, 4k" section whose example prompt is just *"Zoom in on this image, maintaining a 16:9 aspect ratio"* ([DeepMind](https://deepmind.google/models/gemini-image/pro)). The verb isn't magic; locking the content is what preserves detail.

Google's prompting guide adds the two rules that matter here: **be specific**, and **be explicit about what must stay exactly the same** ([Google Cloud guide](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana)).

---

## The prompt (copy-paste, best balance of strictness and output)

```text
Re-render this image as the same image at a higher resolution.

Content: [one or two sentences describing what is in it — the subject and its
colours, the background, the layout, and any text exactly as it is spelled].

Hold everything exactly as it is: the composition, framing, crop and aspect
ratio; every shape and its proportions; every colour, gradient and
transparency; the typefaces and the exact wording, spelling and placement of
all text; the shadows, highlights and the edges between elements.

Raise only the rendering quality: crisp edges and clean curves, fine texture in
the surfaces that are already there, even tone, and detail that reads at full
size. Match the source aspect ratio exactly, so nothing is cropped or added at
the edges, and output at the highest resolution available for it.

Nothing in the scene changes position, size or colour — including small text,
patterns, logos and thin lines.
```

### Shorter variant

Long prompts sometimes drift on smaller models:

```text
Re-render this image as the same image at higher resolution. Same composition,
same crop, same colours, same shapes, same text and same placement, nothing
added or removed. Only crisper edges and finer detail in what is already there.
Highest resolution available for the same aspect ratio.
```

### PT version (panel's second language)

```text
Volta a renderizar esta imagem como a mesma imagem, em maior resolução.

Conteúdo: [uma ou duas frases sobre o que está nela — o motivo e as suas cores,
o fundo, a composição e qualquer texto exatamente como está escrito].

Mantém tudo exatamente igual: a composição, o enquadramento, o corte e a
proporção; cada forma e as suas proporções; cada cor, gradiente e transparência;
os tipos de letra e o texto exato, com a mesma grafia e o mesmo lugar; as sombras,
os realces e as transições entre elementos.

Melhora apenas a qualidade de renderização: contornos nítidos e curvas limpas,
textura fina nas superfícies que já existem, tom uniforme e detalhe legível em
tamanho real. Mantém a mesma proporção da origem, para não cortar nem
acrescentar nada nas margens, e usa a maior resolução disponível para ela.

Nada muda de lugar, de tamanho ou de cor — incluindo texto pequeno, padrões,
logótipos e linhas finas.
```

---

## Why these clauses

| Clause | Source of the rule |
|---|---|
| "Content: …" line with your own description | high-fidelity preservation — describing details is what stops the model inventing them |
| "Hold everything exactly as it is: composition, framing, crop, aspect ratio" | the API's inpainting template ("keep everything else … preserving style, lighting, composition") |
| "Raise only the rendering quality: crisp edges… fine texture" | positive framing — describe what you want instead of "no blur, no artifacts" |
| "highest resolution available for the same aspect ratio" | the app picks the tier from the plan; this only pins the ratio so it isn't re-cropped |
| "small text, patterns, logos, thin lines" | the details that drift first; naming them is the documented trick |

**Avoid:** `upscale 4x`, `8K`, `300 DPI`, `add more detail`, `make it photorealistic`,
`enhance and improve` — the first three have no meaning to the model, the last two
invite reinterpretation.

---

## One thing that matters more than the prompt in this setup

The exported source that `prepareGeminiSource` hands to Gemini **inherits vectorizer.ai's
2-megapixel budget** — `VB.MAX_INPUT_PIXELS = 2097252` in `host/core.jsx` (≈1448×1448 max
on a square). So the file uploaded is already ~2 MP, and a 2K Gemini result (~4 MP) can
only add about a 1.4× linear gain. For Illustrator artwork the cleanest "upscale that
preserves every detail" is still re-exporting the vector at a bigger PNG size — no model
involved, no invented detail.

---

## Open decisions

Two small changes, not yet implemented:

1. Add this as a fifth template — **"Preserve-detail upscale"** — in
   `modules/ai-image/ai-image.js` plus both locales (`aiImgTplUpscale*`).
2. Give the Gemini source export its own pixel budget instead of reusing the 2 MP
   vectorizer cap (a higher-resolution upload for image work, while vectorize runs keep
   their budget).

---

## Sources

- Gemini Apps Help — *Generate & edit images with Gemini Apps* (download 2K with a Google AI plan, 1K without): <https://support.google.com/gemini/answer/14286560>
- Gemini API docs — *Image generation* (inpainting template, high-fidelity detail preservation): <https://ai.google.dev/gemini-api/docs/image-generation>
- Google Cloud Blog — *The ultimate Nano Banana prompting guide* (be specific, positive framing, "be explicit about what to keep exactly the same"): <https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana>
- Google DeepMind — *Gemini 3 Pro Image / Nano Banana Pro* ("Upscale with precision", 1k/2k/4k): <https://deepmind.google/models/gemini-image/pro>
- Google Blog — *7 tips to get the most out of Nano Banana Pro*: <https://blog.google/products-and-platforms/products/gemini/prompting-tips-nano-banana-pro>
- Third-party write-up on app vs API resolution control: <https://projedefteri.com/en/blog/gemini-4k-photo-prompt>
