/**
 * One-shot converter: mermaid (.mmd) → draw.io (.drawio) for backfill.
 * Usage: node diagrams/scripts/mermaid-to-drawio.js
 */
const fs = require('fs');
const path = require('path');

const EXTRACTED = path.join(__dirname, '..', '_extracted');
const OUT = path.join(__dirname, '..');

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildDrawio(cells, pageWidth = 1600, pageHeight = 1200) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" agent="TAVLA" version="24.0.0" type="device">
  <diagram name="Page-1" id="page-1">
    <mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageWidth}" pageHeight="${pageHeight}" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${cells.join('\n')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
}

class Builder {
  constructor() {
    this.id = 2;
    this.cells = [];
    this.nodeIds = new Map();
  }

  nextId() {
    return this.id++;
  }

  addRect(label, x, y, w, h, style = '') {
    const id = this.nextId();
    this.cells.push(
      `        <mxCell id="${id}" value="${escapeXml(label)}" style="rounded=1;whiteSpace=wrap;html=1;${style}" vertex="1" parent="1">
          <mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>
        </mxCell>`,
    );
    return id;
  }

  addGroup(label, x, y, w, h) {
    const id = this.nextId();
    this.cells.push(
      `        <mxCell id="${id}" value="${escapeXml(label)}" style="swimlane;whiteSpace=wrap;html=1;startSize=28;" vertex="1" parent="1">
          <mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>
        </mxCell>`,
    );
    return id;
  }

  addEdge(source, target, dashed = false, label = '') {
    const id = this.nextId();
    const dash = dashed ? 'dashed=1;' : '';
    const edgeLabel = label ? `label=${escapeXml(label)};` : '';
    this.cells.push(
      `        <mxCell id="${id}" value="${escapeXml(label)}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;${dash}${edgeLabel}" edge="1" parent="1" source="${source}" target="${target}">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>`,
    );
    return id;
  }

  registerNode(key, rectId) {
    this.nodeIds.set(key, rectId);
  }

  getNode(key) {
    return this.nodeIds.get(key);
  }
}

function parseNodeDef(line) {
  const match = line.trim().match(/^([A-Za-z0-9_]+)(?:\[(.+?)\]|\(\[(.+?)\]\))?/);
  if (!match) {
    return null;
  }
  return { key: match[1], label: match[2] || match[3] || match[1] };
}

function convertFlowchart(source) {
  const b = new Builder();
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  const subgraphs = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith('flowchart')) {
      continue;
    }
    const subStart = line.match(/^subgraph\s+(\S+)(?:\s+\[(.+?)\])?/);
    if (subStart) {
      current = { name: subStart[2] || subStart[1], nodes: [], edges: [] };
      subgraphs.push(current);
      continue;
    }
    if (line === 'end') {
      current = null;
      continue;
    }
    const edgeMatch = line.match(/^([A-Za-z0-9_]+)\s+(-\.->|-->|==>)\s+([A-Za-z0-9_]+)/);
    if (edgeMatch) {
      const dashed = edgeMatch[2].includes('.');
      if (current) {
        current.edges.push({ from: edgeMatch[1], to: edgeMatch[3], dashed });
      } else {
        b._globalEdges = b._globalEdges || [];
        b._globalEdges.push({ from: edgeMatch[1], to: edgeMatch[3], dashed });
      }
      continue;
    }
    const node = parseNodeDef(line);
    if (node && current) {
      current.nodes.push(node);
      if (!b.getNode(node.key)) {
        b.registerNode(node.key, null);
      }
    } else if (node) {
      if (!b.getNode(node.key)) {
        b.registerNode(node.key, null);
      }
    }
  }

  const laneWidth = 320;
  const laneGap = 24;
  const startX = 40;
  const startY = 40;
  let maxHeight = 0;

  subgraphs.forEach((sub, index) => {
    const x = startX + index * (laneWidth + laneGap);
    const nodeHeight = 52;
    const nodeGap = 16;
    const laneHeight = Math.max(240, 60 + sub.nodes.length * (nodeHeight + nodeGap));
    maxHeight = Math.max(maxHeight, laneHeight);
    const groupId = b.addGroup(sub.name, x, startY, laneWidth, laneHeight);

    sub.nodes.forEach((node, nodeIndex) => {
      const rectId = b.addRect(
        node.label,
        20,
        40 + nodeIndex * (nodeHeight + nodeGap),
        laneWidth - 40,
        nodeHeight,
        'fillColor=#dae8fc;strokeColor=#6c8ebf;',
      );
      b.registerNode(node.key, rectId);
      b.cells[b.cells.length - 1] = b.cells[b.cells.length - 1].replace(
        'parent="1"',
        `parent="${groupId}"`,
      );
    });
  });

  const allEdges = [];
  for (const sub of subgraphs) {
    allEdges.push(...sub.edges);
  }
  if (b._globalEdges) {
    allEdges.push(...b._globalEdges);
  }

  for (const line of lines) {
    const edgeMatch = line.match(/^([A-Za-z0-9_]+)\s+(-\.->|-->|==>)\s+([A-Za-z0-9_]+)/);
    if (edgeMatch) {
      allEdges.push({
        from: edgeMatch[1],
        to: edgeMatch[3],
        dashed: edgeMatch[2].includes('.'),
      });
    }
  }

  const seen = new Set();
  for (const edge of allEdges) {
    const key = `${edge.from}->${edge.to}:${edge.dashed}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const source = b.getNode(edge.from);
    const target = b.getNode(edge.to);
    if (source && target) {
      b.addEdge(source, target, edge.dashed);
    }
  }

  const pageWidth = startX * 2 + subgraphs.length * (laneWidth + laneGap);
  return buildDrawio(b.cells, pageWidth, maxHeight + 120);
}

function convertSequence(source) {
  const b = new Builder();
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  const participants = [];
  const messages = [];

  for (const line of lines) {
    if (line.startsWith('sequenceDiagram')) {
      continue;
    }
    const participant = line.match(/^participant\s+(\S+)(?:\s+as\s+(.+))?/);
    if (participant) {
      participants.push(participant[2] || participant[1]);
      continue;
    }
    if (line.startsWith('alt ') || line.startsWith('else') || line === 'end') {
      messages.push({ type: 'note', text: line });
      continue;
    }
    const msg = line.match(/^(\S+)(->>|-->>|->|-->>)(.+?):\s*(.+)$/);
    if (msg) {
      messages.push({
        type: 'message',
        from: msg[1],
        to: msg[3],
        arrow: msg[2],
        text: msg[4],
      });
    }
  }

  const boxW = 130;
  const boxH = 44;
  const gap = 24;
  const startX = 40;
  const startY = 40;
  const lifelineTop = startY + boxH + 20;

  participants.forEach((name, index) => {
    const x = startX + index * (boxW + gap);
    const id = b.addRect(name, x, startY, boxW, boxH, 'fillColor=#fff2cc;strokeColor=#d6b656;');
    b.registerNode(name, id);
    const lineId = b.addRect('', x + boxW / 2 - 1, lifelineTop, 2, 40 + messages.length * 36, 'fillColor=#999999;strokeColor=none;');
    b.registerNode(`${name}__line`, lineId);
  });

  let y = lifelineTop + 20;
  for (const message of messages) {
    if (message.type === 'note') {
      b.addRect(message.text, startX, y, 400, 28, 'fillColor=#f5f5f5;strokeColor=#666666;dashed=1;');
      y += 40;
      continue;
    }
    const fromId = b.getNode(message.from);
    const toId = b.getNode(message.to);
    if (fromId && toId) {
      b.addEdge(fromId, toId, message.arrow.includes('--'), message.text);
    }
    y += 36;
  }

  const pageWidth = startX * 2 + participants.length * (boxW + gap);
  const pageHeight = y + 80;
  return buildDrawio(b.cells, pageWidth, pageHeight);
}

function convertEr(source) {
  const b = new Builder();
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  const entities = new Map();
  const relationships = [];

  let currentEntity = null;
  for (const line of lines) {
    if (line.startsWith('erDiagram')) {
      continue;
    }
    const rel = line.match(/^(\S+)\s+\|\|[-o|.\{]+[\|}]\s+(\S+)\s+:\s+(.+)$/);
    if (rel) {
      relationships.push({ from: rel[1], to: rel[2], label: rel[3] });
      if (!entities.has(rel[1])) {
        entities.set(rel[1], []);
      }
      if (!entities.has(rel[2])) {
        entities.set(rel[2], []);
      }
      continue;
    }
    if (line.endsWith('{')) {
      currentEntity = line.replace('{', '').trim();
      entities.set(currentEntity, []);
      continue;
    }
    if (line === '}') {
      currentEntity = null;
      continue;
    }
    if (currentEntity) {
      entities.get(currentEntity).push(line.replace(/,$/, ''));
    }
  }

  const cols = 4;
  const boxW = 220;
  const boxH = 120;
  const gapX = 40;
  const gapY = 40;
  const startX = 40;
  const startY = 40;

  let index = 0;
  for (const [name, fields] of entities.entries()) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = startX + col * (boxW + gapX);
    const y = startY + row * (boxH + gapY);
    const label = fields.length ? `${name}\n─────────\n${fields.slice(0, 4).join('\n')}` : name;
    const id = b.addRect(label, x, y, boxW, boxH, 'fillColor=#d5e8d4;strokeColor=#82b366;');
    b.registerNode(name, id);
    index += 1;
  }

  for (const rel of relationships) {
    const source = b.getNode(rel.from);
    const target = b.getNode(rel.to);
    if (source && target) {
      b.addEdge(source, target, false, rel.label);
    }
  }

  const rows = Math.ceil(entities.size / cols);
  return buildDrawio(b.cells, startX * 2 + cols * (boxW + gapX), startY * 2 + rows * (boxH + gapY));
}

function convertFile(name) {
  const source = fs.readFileSync(path.join(EXTRACTED, `${name}.mmd`), 'utf8').trim();
  let xml;
  if (source.startsWith('sequenceDiagram')) {
    xml = convertSequence(source);
  } else if (source.startsWith('erDiagram')) {
    xml = convertEr(source);
  } else {
    xml = convertFlowchart(source);
  }
  fs.writeFileSync(path.join(OUT, `${name}.drawio`), xml, 'utf8');
  console.log('Wrote', `${name}.drawio`);
}

const files = fs
  .readdirSync(EXTRACTED)
  .filter((file) => file.endsWith('.mmd'))
  .map((file) => file.replace(/\.mmd$/, ''));

for (const file of files) {
  convertFile(file);
}
