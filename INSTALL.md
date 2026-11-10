# Mockup Studio

## Instalação no Windows

1. Clone o repositório:

   ```powershell
   git clone https://github.com/ggmbrinde-stack/mockup-studio.git
   cd mockup-studio
   ```

2. Instale as dependências do agente:

   ```powershell
   cd agent
   npm install
   cd ..
   ```

3. Copie ou sincronize o conteúdo da extensão para:

   ```text
   %APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge\
   ```

4. Ative o modo de desenvolvimento CEP no PowerShell, usando a versão CSXS instalada:

   ```powershell
   New-ItemProperty -Path 'HKCU:\Software\Adobe\CSXS.<ver>' -Name PlayerDebugMode -Value '1' -PropertyType String -Force
   ```

   Para versões CSXS 11 e 12, repita o comando com cada versão aplicável.

5. Reinicie o Adobe Illustrator e abra **Window > Extensions > Vectorizer Bridge**.
