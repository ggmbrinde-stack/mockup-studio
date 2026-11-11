# Mockup Studio

## Instalação no Windows

1. Clone o repositório:

   ```powershell
   git clone https://github.com/ggmbrinde-stack/mockup-studio.git
   cd mockup-studio
   ```

2. Rode o instalador na raiz do repositório. Ele copia apenas os arquivos de runtime para
   `%APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge\`, instala as
dependências do agente (`npm install --omit=dev`), ativa o `PlayerDebugMode` para CSXS 9-16 e
   verifica a versão instalada no final:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```

   Com o Illustrator aberto o instalador **aborta** (ele guarda scripts em cache): feche o app ou
   use `-Force` e reinicie o Illustrator depois. Rodar o script de dentro da pasta instalada
   também é recusado, porque origem e destino seriam a mesma pasta.

3. Reinicie o Adobe Illustrator e abra **Window > Extensions > Vectorizer Bridge**.

Para remover a extensão, rode `powershell -ExecutionPolicy Bypass -File .\uninstall.ps1`
(ela para o daemon antes de apagar); acrescente `-RemoveDebugMode` para também limpar o
`PlayerDebugMode` de CSXS 9-16. Os dados do usuário em
`%USERPROFILE%\Documents\VectorizerBridge` nunca são tocados.
