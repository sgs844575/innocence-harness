const fs = require('fs');
const path = require('path');

const roots = [
  'C:\\Users\\Administractors\\AppData\\Roaming\\InnocenceCode',
  'C:\\Users\\Administractors\\AppData\\Local\\InnocenceCode',
  'C:\\Users\\Administractors\\AppData\\Local\\temp',
  'C:\\temp',
  'D:\\temp'
];

for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  console.log('Checking', root);
  const tasksDir = path.join(root, 'tasks');
  if (!fs.existsSync(tasksDir)) {
    console.log('  No tasks dir');
    continue;
  }
  console.log('  tasks dir:', tasksDir);
  try {
    for (const entry of fs.readdirSync(tasksDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      console.log('  Task dir:', entry.name);
      const eventsPath = path.join(tasksDir, entry.name, 'events.jsonl');
      if (fs.existsSync(eventsPath)) {
        console.log('    Events:', fs.readFileSync(eventsPath, 'utf8'));
      }
    }
  } catch (e) {
    console.log('    Error:', e.message);
  }
}
