import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateSystemPrompt } from '../src/system-prompt.js';
import { activateSkill, buildSkillsCatalogSection, initializeSkillsSupport, loadSkills } from '../src/skills.js';
import { getAllTools } from '../src/tools/index.js';
import { getAllowedPathRoots, validatePath } from '../src/utils/path-validation.js';

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

function skillDoc(name: string, description: string, body: string, extras = ''): string {
  return `---
name: ${name}
description: ${description}
${extras}---

${body}
`;
}

test('loadSkills discovers spec-compliant skill directories and parses metadata', async () => {
  const cwd = await makeTempDir('protoagent-skills-cwd-');
  const homeDir = await makeTempDir('protoagent-skills-home-');

  await writeFile(
    path.join(homeDir, '.agents', 'skills', 'pdf-processing', 'SKILL.md'),
    skillDoc(
      'pdf-processing',
      'Extract text and tables from PDF files when the user asks for PDF work.',
      '# PDF Processing\nUse scripts/extract.py when appropriate.',
      'license: Apache-2.0\ncompatibility: Requires Python 3\nmetadata:\n  author: example\n  version: "1.0"\nallowed-tools: Bash(python:*) Read\n'
    )
  );

  const skills = await loadSkills({ cwd, homeDir });

  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, 'pdf-processing');
  assert.equal(skills[0].description, 'Extract text and tables from PDF files when the user asks for PDF work.');
  assert.equal(skills[0].source, 'user');
  assert.match(skills[0].location, /SKILL\.md$/);
  assert.equal(skills[0].body, '# PDF Processing\nUse scripts/extract.py when appropriate.');
  assert.deepEqual(skills[0].metadata, { author: 'example', version: '1.0' });
  assert.deepEqual(skills[0].allowedTools, ['Bash(python:*)', 'Read']);
});

test('loadSkills ignores malformed or non-compliant skills', async () => {
  const cwd = await makeTempDir('protoagent-skills-cwd-');
  const homeDir = await makeTempDir('protoagent-skills-home-');

  await writeFile(
    path.join(homeDir, '.agents', 'skills', 'missing-description', 'SKILL.md'),
    '---\nname: missing-description\n---\n\nNo description here.\n'
  );
  await writeFile(
    path.join(homeDir, '.agents', 'skills', 'Bad-Name', 'SKILL.md'),
    skillDoc('Bad-Name', 'Uppercase names are invalid.', 'Bad')
  );
  await writeFile(
    path.join(homeDir, '.agents', 'skills', 'wrong-dir', 'SKILL.md'),
    skillDoc('different-name', 'Directory mismatch.', 'Bad')
  );
  await writeFile(
    path.join(homeDir, '.agents', 'skills', 'broken-yaml', 'SKILL.md'),
    '---\nname: broken-yaml\ndescription: [unterminated\n---\n\nBroken\n'
  );

  const skills = await loadSkills({ cwd, homeDir });
  assert.deepEqual(skills, []);
});

test('project-level skills override user-level skills with the same name', async () => {
  const cwd = await makeTempDir('protoagent-skills-cwd-');
  const homeDir = await makeTempDir('protoagent-skills-home-');

  await writeFile(
    path.join(homeDir, '.agents', 'skills', 'code-review', 'SKILL.md'),
    skillDoc('code-review', 'User skill description.', 'user body')
  );
  await writeFile(
    path.join(cwd, '.agents', 'skills', 'code-review', 'SKILL.md'),
    skillDoc('code-review', 'Project skill description.', 'project body')
  );

  const skills = await loadSkills({ cwd, homeDir });

  assert.equal(skills.length, 1);
  assert.equal(skills[0].source, 'project');
  assert.equal(skills[0].body, 'project body');
});

test('buildSkillsCatalogSection only exposes metadata and locations', async () => {
  const cwd = await makeTempDir('protoagent-skills-cwd-');
  const homeDir = await makeTempDir('protoagent-skills-home-');

  await writeFile(
    path.join(cwd, '.agents', 'skills', 'data-analysis', 'SKILL.md'),
    skillDoc('data-analysis', 'Analyze datasets when users ask for charts or reports.', '# Internal instructions')
  );

  const skills = await loadSkills({ cwd, homeDir });
  const catalog = buildSkillsCatalogSection(skills);

  assert.match(catalog, /<available_skills>/);
  assert.match(catalog, /<name>data-analysis<\/name>/);
  assert.match(catalog, /<description>Analyze datasets/);
  assert.match(catalog, /<location>.*SKILL\.md<\/location>/);
  assert.doesNotMatch(catalog, /Internal instructions/);
});

test('initializeSkillsSupport registers activate_skill with constrained enum and allowlists skill directories', async () => {
  const cwd = await makeTempDir('protoagent-skills-cwd-');
  const homeDir = await makeTempDir('protoagent-skills-home-');

  await writeFile(
    path.join(cwd, '.agents', 'skills', 'lint-fixes', 'SKILL.md'),
    skillDoc('lint-fixes', 'Fix lint errors when asked to clean up style issues.', '# Lint Fixes')
  );

  const skills = await initializeSkillsSupport({ cwd, homeDir });
  const activateTool = getAllTools().find((tool) => tool.function.name === 'activate_skill');

  assert.equal(skills.length, 1);
  assert.ok(activateTool);
  assert.deepEqual((activateTool as any).function.parameters.properties.name.enum, ['lint-fixes']);
  assert.ok(getAllowedPathRoots().includes(skills[0].skillDir));
});

test('activateSkill returns wrapped body and bundled resources without frontmatter', async () => {
  const cwd = await makeTempDir('protoagent-skills-cwd-');
  const homeDir = await makeTempDir('protoagent-skills-home-');
  const skillDir = path.join(cwd, '.agents', 'skills', 'pdf-processing');

  await writeFile(
    path.join(skillDir, 'SKILL.md'),
    skillDoc('pdf-processing', 'Use for PDF extraction tasks.', '# PDF Processing\nSee references/REFERENCE.md and scripts/extract.py.')
  );
  await writeFile(path.join(skillDir, 'scripts', 'extract.py'), 'print("extract")\n');
  await writeFile(path.join(skillDir, 'references', 'REFERENCE.md'), '# Reference\n');
  await writeFile(path.join(skillDir, 'assets', 'template.txt'), 'template\n');

  const content = await activateSkill('pdf-processing', { cwd, homeDir });

  assert.match(content, /^<skill_content name="pdf-processing">/);
  assert.match(content, /# PDF Processing/);
  assert.doesNotMatch(content, /^---/m);
  assert.match(content, /Skill directory: .*pdf-processing/);
  assert.match(content, /<file>scripts\/extract.py<\/file>/);
  assert.match(content, /<file>references\/REFERENCE.md<\/file>/);
  assert.match(content, /<file>assets\/template.txt<\/file>/);
});

test('generateSystemPrompt includes skill catalog and activation guidance, not eager-loaded instructions', async () => {
  const originalCwd = process.cwd();
  const cwd = await makeTempDir('protoagent-skills-cwd-');
  const homeDir = await makeTempDir('protoagent-skills-home-');

  await writeFile(
    path.join(cwd, '.agents', 'skills', 'repo-docs', 'SKILL.md'),
    skillDoc('repo-docs', 'Use when documenting repository behavior.', '# Hidden body\nDetailed instructions')
  );

  process.chdir(cwd);
  const originalHomedir = os.homedir;
  (os as any).homedir = () => homeDir;

  try {
    const prompt = await generateSystemPrompt();
    assert.match(prompt, /AVAILABLE SKILLS/);
    assert.match(prompt, /call the activate_skill tool/);
    assert.match(prompt, /<name>repo-docs<\/name>/);
    assert.doesNotMatch(prompt, /Hidden body/);
  } finally {
    process.chdir(originalCwd);
    (os as any).homedir = originalHomedir;
  }
});

test('validatePath allows access to activated skill resources via allowlisted roots', async () => {
  const cwd = await makeTempDir('protoagent-skills-cwd-');
  const homeDir = await makeTempDir('protoagent-skills-home-');
  const skillDir = path.join(cwd, '.agents', 'skills', 'pdf-processing');
  const resourcePath = path.join(skillDir, 'references', 'REFERENCE.md');

  await writeFile(
    path.join(skillDir, 'SKILL.md'),
    skillDoc('pdf-processing', 'Use for PDF extraction tasks.', '# Body')
  );
  await writeFile(resourcePath, '# Reference\n');

  await initializeSkillsSupport({ cwd, homeDir });
  const validated = await validatePath(resourcePath);

  assert.match(validated, /REFERENCE\.md$/);
});
