const { execSync } = require('child_process');
const { performance } = require('perf_hooks');
const fs = require('fs');
const path = require('path');

async function measureBuild() {
  // Configurações
  const versions = ['edge-functions@5.0.0-stage.1', 'edge-functions@latest'];
  const preset = 'next';
  const entry = null;
  const runs = 8;
  
  // Criar diretório benchmark se não existir
  const benchmarkDir = path.join(__dirname, 'benchmark');
  if (!fs.existsSync(benchmarkDir)) {
    fs.mkdirSync(benchmarkDir);
  }
  
  const resultsFile = path.join(benchmarkDir, 'benchmark-results.json');
  const htmlFile = path.join(benchmarkDir, 'benchmark-chart.html');
  
  console.log('\nBenchmarking builds:\n');

  const benchmarkResults = {};

  // Primeiro, vamos medir o tamanho dos pacotes npm
  console.log('\n=== Measuring npm package sizes ===\n');
  
  const tempDir = path.join(__dirname, 'temp-package-size');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }
  
  process.chdir(tempDir);
  
  const packageSizes = {};
  
  for (const version of versions) {
    console.log(`Measuring size of ${version}...`);
    
    // Limpar diretório temporário
    try {
      execSync('rm -rf node_modules package.json package-lock.json');
    } catch (e) {
      // Ignora se os arquivos não existirem
    }
    
    // Criar package.json temporário
    fs.writeFileSync('package.json', JSON.stringify({
      name: "package-size-test",
      version: "1.0.0",
      dependencies: {}
    }));
    
    // Instalar o pacote
    try {
      execSync(`npm install ${version} --no-save`, { stdio: 'inherit' });
      
      // Medir o tamanho do pacote instalado
      const packagePath = path.join('node_modules', 'edge-functions');
      const packageSize = getDirSize(packagePath);
      
      packageSizes[version] = packageSize;
      console.log(`Size of ${version}: ${formatBytes(packageSize)}`);
    } catch (e) {
      console.error(`Error measuring package size: ${e.message}`);
    }
  }
  
  // Voltar ao diretório original
  process.chdir(__dirname);
  
  // Remover diretório temporário
  try {
    execSync(`rm -rf ${tempDir}`);
  } catch (e) {
    console.error(`Error removing temp directory: ${e.message}`);
  }
  
  // Adicionar tamanhos dos pacotes aos resultados
  benchmarkResults.packageSizes = packageSizes;
  
  
  for (const version of versions) {
    console.log(`\n=== Testing ${version} ===\n`);
    
    // Limpar builds anteriores
    console.log('Cleaning previous builds...');
    try {
      execSync('rm -rf .edge dist .vercel .next azion.config.js azion.config.cjs azion.config.mjs azion.config.ts');
    } catch (e) {
      // Ignora se as pastas não existirem
    }

    const results = [];

    for (let i = 1; i <= runs; i++) {
      console.log(`\nRun ${i}:`);
      const start = performance.now();
      
      // Construir o comando com o argumento --entry apenas se entry não for nulo ou indefinido
      let buildCommand = `npx --yes ${version} build --preset ${preset}`;
      if (entry) {
        buildCommand += ` --entry ${entry}`;
      }
      
      execSync(buildCommand, { stdio: 'inherit' });
      const end = performance.now();
      const time = (end - start) / 1000;
      results.push(time);
      console.log(`Time: ${time.toFixed(2)}s`);
      
      // Obter tamanho do build após o primeiro build
      if (i === 1) {
        const buildSize = getBuildSize();
        console.log(`Build size: ${formatBytes(buildSize)}`);
        benchmarkResults[version] = {
          ...benchmarkResults[version],
          buildSize
        };
      }
      
      // Limpar builds após cada execução para garantir consistência
      try {
        execSync('rm -rf .edge dist .vercel .next azion.config.js azion.config.cjs azion.config.mjs azion.config.ts');
      } catch (e) {
        // Ignora se as pastas não existirem
      }
    }

    // Calcular estatísticas
    const average = results.reduce((a, b) => a + b, 0) / results.length;
    const min = Math.min(...results);
    const max = Math.max(...results);
    
    // Calcular desvio padrão
    const variance = results.reduce((acc, val) => acc + Math.pow(val - average, 2), 0) / results.length;
    const stdDev = Math.sqrt(variance);
    
    console.log(`\nResultados para ${version}:`);
    console.log(`- Média: ${average.toFixed(2)}s`);
    console.log(`- Mínimo: ${min.toFixed(2)}s`);
    console.log(`- Máximo: ${max.toFixed(2)}s`);
    console.log(`- Desvio Padrão: ${stdDev.toFixed(2)}s`);
    console.log(`- Tamanho do build: ${formatBytes(benchmarkResults[version].buildSize)}`);

    benchmarkResults[version] = {
      ...benchmarkResults[version],
      runs: results,
      average,
      min,
      max,
      stdDev,
      timestamp: new Date().toISOString()
    };
  }

  // Comparação entre versões
  const [version1, version2] = versions;
  const diff = benchmarkResults[version2].average - benchmarkResults[version1].average;
  const percentChange = (diff / benchmarkResults[version1].average) * 100;
  
  console.log('\n=== Comparação ===');
  console.log(`Diferença (${version2} vs ${version1}): ${diff.toFixed(2)}s (${percentChange.toFixed(2)}%)`);
  
  let fasterVersion;
  if (diff < 0) {
    console.log(`${version2} é ${Math.abs(percentChange).toFixed(2)}% mais rápido que ${version1}`);
    fasterVersion = version2;
  } else if (diff > 0) {
    console.log(`${version1} é ${Math.abs(percentChange).toFixed(2)}% mais rápido que ${version2}`);
    fasterVersion = version1;
  } else {
    console.log(`${version2} tem o mesmo desempenho que ${version1}`);
    fasterVersion = 'same';
  }
  
  // Comparação de tamanho dos pacotes npm
  const npmSizeDiff = packageSizes[version2] - packageSizes[version1];
  const npmSizePercentChange = (npmSizeDiff / packageSizes[version1]) * 100;
  
  console.log('\n=== Comparação de tamanho dos pacotes npm ===');
  console.log(`${version1}: ${formatBytes(packageSizes[version1])}`);
  console.log(`${version2}: ${formatBytes(packageSizes[version2])}`);
  
  if (npmSizeDiff > 0) {
    console.log(`${version1} é ${Math.abs(npmSizePercentChange).toFixed(2)}% menor que ${version2} (${formatBytes(Math.abs(npmSizeDiff))} economizados)`);
  } else {
    console.log(`${version1} é ${Math.abs(npmSizePercentChange).toFixed(2)}% maior que ${version2} (${formatBytes(Math.abs(npmSizeDiff))} adicionais)`);
  }

  // Salvar resultados em arquivo JSON
  benchmarkResults.comparison = {
    diff,
    percentChange,
    fasterVersion
  };
  
  benchmarkResults.packageSizeComparison = {
    sizes: packageSizes,
    diff: npmSizeDiff,
    percentChange: npmSizePercentChange
  };
  
  fs.writeFileSync(resultsFile, JSON.stringify(benchmarkResults, null, 2));
  console.log(`\nResultados salvos em ${resultsFile}`);
  
  // Gerar o arquivo HTML com os resultados
  generateHtmlReport(benchmarkResults, htmlFile);
  console.log(`\nRelatório HTML gerado em ${htmlFile}`);
}

// Função para gerar o relatório HTML
function generateHtmlReport(data, outputFile) {
  const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
       <title>Azion Bundler Refactor - Next.js Benchmark</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.0.0"></script>
    <link rel="icon" type="image/x-icon" href="/favicon.ico">
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: white;
            border-radius: 10px;
            padding: 20px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            margin-bottom: 20px;
        }
        h1, h2, h3 {
            color: #333;
            text-align: center;
        }
        .subtitle {
            text-align: center;
            color: #666;
            margin-top: -10px;
            margin-bottom: 20px;
            font-size: 1.1em;
        }
        .chart-container {
            position: relative;
            height: 400px;
            margin: 20px 0;
        }
        .comparison {
            background-color: #f0f8ff;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
            text-align: center;
            font-size: 1.2em;
        }
        .faster {
            color: #2e8b57;
            font-weight: bold;
        }
        .slower {
            color: #dc143c;
            font-weight: bold;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin: 20px 0;
        }
        .stat-card {
            background-color: #f9f9f9;
            border-radius: 8px;
            padding: 15px;
            text-align: center;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        }
        .stat-value {
            font-size: 1.8em;
            font-weight: bold;
            margin: 10px 0;
            color: #444;
        }
        .stat-label {
            color: #666;
            font-size: 0.9em;
        }
        .npm-package-size {
            background-color: #f0f8ff;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
            text-align: center;
        }
        .npm-package-size h2 {
            margin-top: 0;
        }
        .build-details {
            margin-top: 40px;
        }
        .unit {
            font-size: 0.7em;
            color: #777;
            vertical-align: super;
        }
        .section-title {
            background-color: #f0f8ff;
            padding: 10px;
            border-radius: 5px;
            margin-bottom: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Benchmark Azion Bundler</h1>
        <div class="subtitle">Projeto Next.js App Router (v13.5.6) com Turso</div>
        
        <div id="content">
            <div id="npm-package-size" class="npm-package-size">
                <h2 class="section-title">Tamanho do Pacote NPM</h2>
                <div class="chart-container">
                    <canvas id="npmSizeChart"></canvas>
                </div>
            </div>
            
            <div class="build-details">
                <h2 class="section-title">Desempenho de Build - Next.js App Router</h2>
                <div class="comparison" id="comparison-text"></div>
                
                <div class="chart-container">
                    <canvas id="averageChart"></canvas>
                </div>
                
                <h2>Estatísticas Detalhadas</h2>
                <div class="stats-grid" id="stats-grid"></div>
                
                <div class="chart-container">
                    <canvas id="runsChart"></canvas>
                </div>
            </div>
        </div>
    </div>

    <script>
        // Dados do benchmark
        const data = ${JSON.stringify(data)};
        
        // Renderizar gráficos
        renderCharts(data);

        function renderCharts(data) {
            // Configurar versões
            const versions = Object.keys(data).filter(key => 
                key !== 'comparison' && 
                key !== 'packageSizes' && 
                key !== 'packageSizeComparison'
            );
            
            // Formatar os nomes das versões para exibição
            const formattedVersions = versions.map(v => {
                if (v.includes('5.0.0-stage')) return 'edge-functions@5.0';
                if (v.includes('latest')) return 'edge-functions@4.x';
                return v;
            });
            
            // Renderizar gráfico de tamanho do pacote npm
            if (data.packageSizes) {
                const npmSizeCtx = document.getElementById('npmSizeChart').getContext('2d');
                new Chart(npmSizeCtx, {
                    type: 'bar',
                    data: {
                        labels: formattedVersions,
                        datasets: [{
                            label: 'Tamanho do Pacote NPM',
                            data: versions.map(v => data.packageSizes[v]),
                            backgroundColor: [
                                'rgba(54, 162, 235, 0.7)',
                                'rgba(255, 99, 132, 0.7)'
                            ],
                            borderColor: [
                                'rgba(54, 162, 235, 1)',
                                'rgba(255, 99, 132, 1)'
                            ],
                            borderWidth: 1
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            title: {
                                display: true,
                                text: 'Comparação de Tamanho do Pacote NPM',
                                font: {
                                    size: 18
                                }
                            },
                            legend: {
                                display: false
                            },
                            datalabels: {
                                anchor: 'end',
                                align: 'top',
                                formatter: (value) => formatBytes(value),
                                font: {
                                    weight: 'bold'
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                title: {
                                    display: true,
                                    text: 'Tamanho (bytes)'
                                }
                            }
                        }
                    }
                });
                
                // Adicionar texto de comparação
                if (data.packageSizeComparison) {
                    const percentChange = Math.abs(data.packageSizeComparison.percentChange).toFixed(2);
                    const npmSizeElement = document.getElementById('npm-package-size');
                    
                    const comparisonDiv = document.createElement('div');
                    comparisonDiv.className = 'comparison';
                    
                    if (data.packageSizeComparison.diff > 0) {
                        comparisonDiv.innerHTML = \`<span class="faster">\${formattedVersions[0]}</span> é <span class="faster">\${percentChange}%</span> menor que \${formattedVersions[1]} (\${formatBytes(Math.abs(data.packageSizeComparison.diff))} economizados)\`;
                    } else {
                        comparisonDiv.innerHTML = \`<span class="slower">\${formattedVersions[0]}</span> é <span class="slower">\${percentChange}%</span> maior que \${formattedVersions[1]} (\${formatBytes(Math.abs(data.packageSizeComparison.diff))} adicionais)\`;
                    }
                    
                    npmSizeElement.appendChild(comparisonDiv);
                }
            }
            
            // Renderizar texto de comparação
            if (data.comparison) {
                const comparisonElement = document.getElementById('comparison-text');
                const percentChange = Math.abs(data.comparison.percentChange).toFixed(2);
                const timeDiff = Math.abs(data.comparison.diff).toFixed(2);
                
                const fasterVersion = data.comparison.fasterVersion;
                
                if (fasterVersion === versions[0]) {
                    comparisonElement.innerHTML = \`<span class="faster">\${formattedVersions[0]}</span> é <span class="faster">\${percentChange}%</span> mais rápido que \${formattedVersions[1]} (\${timeDiff}s economizados)\`;
                } else if (fasterVersion === versions[1]) {
                    comparisonElement.innerHTML = \`<span class="faster">\${formattedVersions[1]}</span> é <span class="faster">\${percentChange}%</span> mais rápido que \${formattedVersions[0]} (\${timeDiff}s economizados)\`;
                } else {
                    comparisonElement.innerHTML = \`\${formattedVersions[0]} e \${formattedVersions[1]} têm desempenho similar\`;
                }
            }
            
            // Renderizar estatísticas
            const statsGrid = document.getElementById('stats-grid');
            versions.forEach((version, index) => {
                const versionData = data[version];
                const versionDisplay = formattedVersions[index];
                
                statsGrid.innerHTML += \`
                    <div class="stat-card">
                        <div class="stat-label">Versão</div>
                        <div class="stat-value">\${versionDisplay}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Tempo Médio</div>
                        <div class="stat-value">\${versionData.average.toFixed(2)}<span class="unit">s</span></div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Tempo Mínimo</div>
                        <div class="stat-value">\${versionData.min.toFixed(2)}<span class="unit">s</span></div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Tempo Máximo</div>
                        <div class="stat-value">\${versionData.max.toFixed(2)}<span class="unit">s</span></div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Tamanho do Build</div>
                        <div class="stat-value">\${formatBytes(versionData.buildSize)}</div>
                    </div>
                \`;
            });
            
            // Gráfico de barras para médias
            const avgCtx = document.getElementById('averageChart').getContext('2d');
            new Chart(avgCtx, {
                type: 'bar',
                data: {
                    labels: formattedVersions,
                    datasets: [{
                        label: 'Tempo Médio de Build (segundos)',
                        data: versions.map(v => data[v].average),
                        backgroundColor: [
                            'rgba(54, 162, 235, 0.7)',
                            'rgba(255, 99, 132, 0.7)'
                        ],
                        borderColor: [
                            'rgba(54, 162, 235, 1)',
                            'rgba(255, 99, 132, 1)'
                        ],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: {
                            display: true,
                            text: 'Comparação de Tempo Médio de Build - Next.js App Router',
                            font: {
                                size: 18
                            }
                        },
                        legend: {
                            display: false
                        },
                        datalabels: {
                            anchor: 'end',
                            align: 'top',
                            formatter: (value) => value.toFixed(2) + 's',
                            font: {
                                weight: 'bold'
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Tempo (segundos)'
                            }
                        }
                    }
                }
            });
            
            // Gráfico de linha para execuções individuais
            const runsCtx = document.getElementById('runsChart').getContext('2d');
            new Chart(runsCtx, {
                type: 'line',
                data: {
                    labels: Array.from({ length: Math.max(...versions.map(v => data[v].runs.length)) }, (_, i) => \`Execução \${i + 1}\`),
                    datasets: versions.map((version, index) => ({
                        label: formattedVersions[index],
                        data: data[version].runs,
                        borderColor: index === 0 ? 'rgba(54, 162, 235, 1)' : 'rgba(255, 99, 132, 1)',
                        backgroundColor: index === 0 ? 'rgba(54, 162, 235, 0.2)' : 'rgba(255, 99, 132, 0.2)',
                        fill: true,
                        tension: 0.1
                    }))
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: {
                            display: true,
                            text: 'Tempo de Build por Execução - Next.js App Router',
                            font: {
                                size: 18
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Tempo (segundos)'
                            }
                        }
                    }
                }
            });
        }
        
        // Função para formatar bytes em unidades legíveis
        function formatBytes(bytes, decimals = 2) {
            if (!bytes || bytes === 0) return '0 Bytes';
            
            const k = 1024;
            const dm = decimals < 0 ? 0 : decimals;
            const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
            
            const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
            
            return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
        }
    </script>
</body>
</html>`;

  fs.writeFileSync(outputFile, htmlContent);
}

// Função para obter o tamanho do build
function getBuildSize() {
  let totalSize = 0;
  
  // Verificar se existe o diretório .edge
  if (fs.existsSync('.edge')) {
    totalSize += getDirSize('.edge');
  }
  
  // Verificar se existe o diretório dist
  if (fs.existsSync('dist')) {
    totalSize += getDirSize('dist');
  }
  
  return totalSize;
}

// Função para calcular o tamanho de um diretório recursivamente
function getDirSize(dirPath) {
  let size = 0;
  
  if (!fs.existsSync(dirPath)) {
    return 0;
  }
  
  const files = fs.readdirSync(dirPath);
  
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      size += getDirSize(filePath);
    } else {
      size += stat.size;
    }
  }
  
  return size;
}

// Função para formatar bytes em unidades legíveis
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

measureBuild().catch(console.error); 