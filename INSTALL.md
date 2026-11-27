# Mockup Studio

## Instalação no Windows

### Um ficheiro (recomendado)

`Install-Mockup-Studio.cmd` — na raiz do repositório ou na pasta partilhada. Não precisa de git,
de PowerShell manual nem de administrador.

1. Duplo clique em `Install-Mockup-Studio.cmd`. Abre-se um menu: **Install or update**,
   **Clean install** (remove a cópia antiga e instala de novo), **Remove from this computer**,
   **Open my files**, **Quit**. O cabeçalho mostra a versão já instalada, se existir. Tudo corre
   offline a partir do ficheiro; remover e a limpeza usam o `uninstall.ps1` e mantêm
   `Documents\VectorizerBridge`.
2. Fechar e reabrir o Adobe Illustrator.
3. Abrir **Window > Extensions > Mockup Studio**.
4. Extensão do Chrome (opcional, para o Google Flow), só uma vez:
   `chrome://extensions` > ativar "Modo de programador" > "Carregar sem compactação" >
   `%LOCALAPPDATA%\MockupStudio\flow-bridge`.
5. Iniciar sessão no vectorizer.ai uma vez (perfil em
   `Documents\VectorizerBridge\vectorizer-profile`).

O `.cmd` tem a versão atual embutida: não precisa do repositório nem de downloads. Descompacta
para `%TEMP%`, copia os ficheiros de runtime, instala as dependências do agente quando faltam,
ativa o `PlayerDebugMode` para CSXS 9-16, verifica o resultado e apaga a cópia temporária.

O que escreve (e nada além disso):

- `%APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge` — a extensão
- `%LOCALAPPDATA%\MockupStudio\flow-bridge` — ficheiros da extensão do Chrome
- `HKCU\Software\Adobe\CSXS.9-16` -> `PlayerDebugMode = 1`

Nunca escreve, move ou apaga nada em `%USERPROFILE%\Documents\VectorizerBridge`. Também recusa
correr de dentro da pasta instalada, para não copiar a extensão sobre si própria.

Requisitos: Windows 10/11, Illustrator 2025 (29.x) ou mais recente, Node.js 22.12+ no PATH (o
agente corre `npm install --omit=dev`) e Chrome ou Edge.

### Reconstruir o instalador

Depois de alterar o painel (`dist/`, `host/`, `js/`, `agent/` ou `CSXS/`):

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-installer-cmd.ps1
```

O script empacota os ficheiros de runtime, o `install.ps1` e os ficheiros do Chrome em
`tools\installer-header.txt` + payload e reescreve `Install-Mockup-Studio.cmd`. Falha antes de
gerar o ficheiro se faltar algum ficheiro obrigatório.

### Desinstalar

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

Ela para o daemon antes de apagar; acrescente `-RemoveDebugMode` para também limpar o
`PlayerDebugMode` de CSXS 9-16. Os dados do utilizador em
`%USERPROFILE%\Documents\VectorizerBridge` nunca são tocados.

### Notas

- Para desenvolvimento também pode correr `powershell -ExecutionPolicy Bypass -File .\install.ps1`
  diretamente. É o mesmo instalador que o `.cmd` executa, com a mesma interface de passos; recusa
  correr com o Illustrator aberto a menos que use `-Force`.
- O antigo `install-online.ps1` (instalação a partir de um release do GitHub) foi retirado do
  fluxo e está arquivado em `docs/archive/install-online.ps1`. Existe um único caminho suportado:
  o `Install-Mockup-Studio.cmd`.
