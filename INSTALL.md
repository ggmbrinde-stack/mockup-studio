# Mockup Studio

## Instalação no Windows

### Uma linha (recomendado)

No PowerShell **ou** no cmd.exe, cole:

```
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((irm 'https://raw.githubusercontent.com/ggmbrinde-stack/mockup-studio/main/install-online.ps1') -join [Environment]::NewLine)"
```

O `-join [Environment]::NewLine` é necessário: jogar o `irm` direto no `iex` quebra o script em linhas e o
comentário de cabeçalho falha no Windows PowerShell 5.1.

O instalador baixa o release mais recente do GitHub, confere o **SHA-256**, valida o conteúdo do
arquivo **antes** de mexer na instalação, garante o Node.js, faz backup da versão instalada, para
o daemon, copia os arquivos, instala as dependências do agente quando faltam, ativa o
`PlayerDebugMode` para CSXS 9-16 e verifica o resultado. Se algo falhar depois da cópia, ele
**restaura o backup sozinho**.

O que ele escreve (e nada além disso):

- `%APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge` — a extensão
- `%LOCALAPPDATA%\VectorizerBridge\install-backups` — cópias para rollback (mantém 2)
- `%LOCALAPPDATA%\Programs\nodejs` — Node.js LTS, **só** quando o computador não tem Node
- `HKCU\Software\Adobe\CSXS.9-16` → `PlayerDebugMode = 1`

Ele **nunca** escreve, move ou apaga nada em `%USERPROFILE%\Documents\VectorizerBridge`, nunca
apaga a pasta da extensão, não pede administrador, não altera PATH e não toca em outras chaves do
registro.

Se o computador não tem Node.js, ele baixa o build oficial LTS para Windows, confere o hash no
`SHASUMS256.txt` do nodejs.org e descompacta em `%LOCALAPPDATA%\Programs\nodejs` — sem
administrador e sem mexer no PATH. Um Node.js já instalado é usado e **nunca** alterado.

Ele **aborta sem alterar nada** quando: o download do release falha; o SHA-256 não bate; o zip
não tem `CSXS/manifest.xml`; o download do Node.js não pode ser verificado; ou o destino não é a
pasta de extensões do CEP.

Pré-requisitos: Windows 10/11, Illustrator 2025/2026+ e Chrome ou Edge. O Node.js LTS é
instalado automaticamente quando falta.

### Manual, a partir do repositório

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

### Desinstalar

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

Ela para o daemon antes de apagar; acrescente `-RemoveDebugMode` para também limpar o
`PlayerDebugMode` de CSXS 9-16. Os dados do usuário em
`%USERPROFILE%\Documents\VectorizerBridge` nunca são tocados. O Node.js privado em
`%LOCALAPPDATA%\Programs\nodejs` também fica, porque pode estar a ser usado por outras
ferramentas; apague essa pasta à mão se não precisar dele.
