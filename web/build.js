const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Installing dependencies...');
try {
  execSync('npm install --legacy-peer-deps', { stdio: 'inherit' });
} catch (error) {
  console.error('Failed to install dependencies:', error);
  process.exit(1);
}

console.log('Building application...');
try {
  // Check if dist directory exists and remove it
  const distPath = path.join(__dirname, 'dist');
  if (fs.existsSync(distPath)) {
    fs.rmSync(distPath, { recursive: true, force: true });
  }
  
  // Try different build commands
  const commands = [
    'npx vite build',
    'npm run build',
    'vite build'
  ];
  
  let buildSuccess = false;
  
  for (const cmd of commands) {
    try {
      console.log(`Trying command: ${cmd}`);
      execSync(cmd, { stdio: 'inherit' });
      console.log(`Build completed successfully with: ${cmd}`);
      buildSuccess = true;
      break;
    } catch (cmdError) {
      console.log(`Command failed: ${cmd}`);
      continue;
    }
  }
  
  if (!buildSuccess) {
    throw new Error('All build commands failed');
  }
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}
