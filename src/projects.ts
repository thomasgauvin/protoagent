/**
 * Project management for Manager Agent
 * 
 * Projects organize sessions into cohesive work streams with:
 * - Goals and constraints
 * - Milestones with dependencies
 * - Session allocations
 * - Progress tracking
 */

import { logger } from './utils/logger.js'
import { mkdir, readFile, writeFile, access } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

const PROJECTS_DIR = join(homedir(), '.protoagent', 'projects')

export interface Project {
  id: string
  name: string
  description: string
  status: 'planning' | 'in_progress' | 'review' | 'complete' | 'archived'
  goals: string[]
  constraints: string[]
  successCriteria: string[]
  sessionIds: string[]
  milestones: Milestone[]
  createdAt: Date
  updatedAt: Date
  metadata?: Record<string, any>
}

export interface Milestone {
  id: string
  name: string
  description: string
  status: 'pending' | 'in_progress' | 'complete' | 'blocked'
  dependsOn: string[] // Milestone IDs
  assignedSessionIds: string[]
  deliverables: string[]
  completedAt?: Date
}

export interface Allocation {
  id: string
  sessionId: string
  projectId: string
  milestoneId?: string
  task: string
  goal: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  status: 'assigned' | 'in_progress' | 'complete'
  assignedAt: Date
  completedAt?: Date
}

// In-memory cache
const projectsCache = new Map<string, Project>()
const allocationsCache = new Map<string, Allocation>()
let initialized = false

/**
 * Initialize projects storage
 */
async function initStorage(): Promise<void> {
  if (initialized) return
  
  try {
    await mkdir(PROJECTS_DIR, { recursive: true })
    initialized = true
    logger.debug('Projects storage initialized')
  } catch (err: any) {
    logger.error(`Failed to initialize projects storage: ${err.message}`)
    throw err
  }
}

/**
 * Get project file path
 */
function getProjectPath(projectId: string): string {
  return join(PROJECTS_DIR, `${projectId}.json`)
}

/**
 * Generate unique ID
 */
function generateId(prefix: string = ''): string {
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Create a new project
 */
export async function createProject(
  name: string,
  description: string = '',
  goals: string[] = [],
  constraints: string[] = []
): Promise<Project> {
  await initStorage()
  
  const project: Project = {
    id: generateId('proj-'),
    name,
    description,
    status: 'planning',
    goals,
    constraints,
    successCriteria: [],
    sessionIds: [],
    milestones: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  
  await saveProject(project)
  logger.info(`Created project: ${name} (${project.id})`)
  
  return project
}

/**
 * Save project to disk
 */
export async function saveProject(project: Project): Promise<void> {
  await initStorage()
  
  project.updatedAt = new Date()
  projectsCache.set(project.id, project)
  
  try {
    await writeFile(
      getProjectPath(project.id),
      JSON.stringify(project, null, 2),
      'utf-8'
    )
  } catch (err: any) {
    logger.error(`Failed to save project ${project.id}: ${err.message}`)
    throw err
  }
}

/**
 * Load project from disk
 */
export async function loadProject(projectId: string): Promise<Project | null> {
  // Check cache first
  if (projectsCache.has(projectId)) {
    return projectsCache.get(projectId)!
  }
  
  try {
    const data = await readFile(getProjectPath(projectId), 'utf-8')
    const project = JSON.parse(data) as Project
    
    // Restore Date objects
    project.createdAt = new Date(project.createdAt)
    project.updatedAt = new Date(project.updatedAt)
    if (project.milestones) {
      project.milestones.forEach(m => {
        if (m.completedAt) m.completedAt = new Date(m.completedAt)
      })
    }
    
    projectsCache.set(projectId, project)
    return project
  } catch (err: any) {
    if (err.code === 'ENOENT') return null
    logger.error(`Failed to load project ${projectId}: ${err.message}`)
    return null
  }
}

/**
 * List all projects
 */
export async function listProjects(): Promise<Project[]> {
  await initStorage()
  
  try {
    const { readdir } = await import('fs/promises')
    const files = await readdir(PROJECTS_DIR)
    const projects: Project[] = []
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const projectId = file.slice(0, -5)
        const project = await loadProject(projectId)
        if (project) projects.push(project)
      }
    }
    
    // Sort by updatedAt descending
    return projects.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  } catch (err: any) {
    logger.error(`Failed to list projects: ${err.message}`)
    return []
  }
}

/**
 * Delete a project
 */
export async function deleteProject(projectId: string): Promise<boolean> {
  const { unlink } = await import('fs/promises')
  
  try {
    await unlink(getProjectPath(projectId))
    projectsCache.delete(projectId)
    logger.info(`Deleted project: ${projectId}`)
    return true
  } catch (err: any) {
    if (err.code === 'ENOENT') return false
    logger.error(`Failed to delete project ${projectId}: ${err.message}`)
    return false
  }
}

/**
 * Add a milestone to a project
 */
export async function addMilestone(
  projectId: string,
  name: string,
  description: string = '',
  dependsOn: string[] = []
): Promise<Milestone | null> {
  const project = await loadProject(projectId)
  if (!project) return null
  
  const milestone: Milestone = {
    id: generateId('ms-'),
    name,
    description,
    status: 'pending',
    dependsOn,
    assignedSessionIds: [],
    deliverables: [],
  }
  
  project.milestones.push(milestone)
  await saveProject(project)
  
  logger.info(`Added milestone "${name}" to project ${projectId}`)
  return milestone
}

/**
 * Update milestone status
 */
export async function updateMilestoneStatus(
  projectId: string,
  milestoneId: string,
  status: Milestone['status']
): Promise<boolean> {
  const project = await loadProject(projectId)
  if (!project) return false
  
  const milestone = project.milestones.find(m => m.id === milestoneId)
  if (!milestone) return false
  
  milestone.status = status
  if (status === 'complete') {
    milestone.completedAt = new Date()
  }
  
  await saveProject(project)
  logger.info(`Updated milestone ${milestoneId} status to ${status}`)
  return true
}

/**
 * Assign session to project
 */
export async function assignSessionToProject(
  sessionId: string,
  projectId: string,
  milestoneId?: string
): Promise<boolean> {
  const project = await loadProject(projectId)
  if (!project) return false
  
  if (!project.sessionIds.includes(sessionId)) {
    project.sessionIds.push(sessionId)
  }
  
  if (milestoneId) {
    const milestone = project.milestones.find(m => m.id === milestoneId)
    if (milestone && !milestone.assignedSessionIds.includes(sessionId)) {
      milestone.assignedSessionIds.push(sessionId)
    }
  }
  
  // Update project status if in planning
  if (project.status === 'planning' && project.sessionIds.length > 0) {
    project.status = 'in_progress'
  }
  
  await saveProject(project)
  logger.info(`Assigned session ${sessionId} to project ${projectId}`)
  return true
}

/**
 * Remove session from project
 */
export async function removeSessionFromProject(
  sessionId: string,
  projectId: string
): Promise<boolean> {
  const project = await loadProject(projectId)
  if (!project) return false
  
  project.sessionIds = project.sessionIds.filter(id => id !== sessionId)
  
  // Also remove from milestones
  project.milestones.forEach(m => {
    m.assignedSessionIds = m.assignedSessionIds.filter(id => id !== sessionId)
  })
  
  await saveProject(project)
  logger.info(`Removed session ${sessionId} from project ${projectId}`)
  return true
}

/**
 * Get project status summary
 */
export async function getProjectStatus(projectId: string): Promise<{
  project: Project | null
  summary: {
    totalMilestones: number
    completedMilestones: number
    inProgressMilestones: number
    blockedMilestones: number
    totalSessions: number
    completionPercentage: number
  }
} | null> {
  const project = await loadProject(projectId)
  if (!project) return null
  
  const totalMilestones = project.milestones.length
  const completedMilestones = project.milestones.filter(m => m.status === 'complete').length
  const inProgressMilestones = project.milestones.filter(m => m.status === 'in_progress').length
  const blockedMilestones = project.milestones.filter(m => m.status === 'blocked').length
  
  const completionPercentage = totalMilestones > 0
    ? Math.round((completedMilestones / totalMilestones) * 100)
    : 0
  
  return {
    project,
    summary: {
      totalMilestones,
      completedMilestones,
      inProgressMilestones,
      blockedMilestones,
      totalSessions: project.sessionIds.length,
      completionPercentage,
    },
  }
}

/**
 * Find projects by session ID
 */
export async function findProjectsBySession(sessionId: string): Promise<Project[]> {
  const allProjects = await listProjects()
  return allProjects.filter(p => p.sessionIds.includes(sessionId))
}

/**
 * Generate project report
 */
export async function generateProjectReport(projectId: string): Promise<string | null> {
  const project = await loadProject(projectId)
  if (!project) return null
  
  const status = await getProjectStatus(projectId)
  const summary = status?.summary ?? {
    totalMilestones: project.milestones.length,
    completedMilestones: project.milestones.filter(m => m.status === 'complete').length,
    inProgressMilestones: project.milestones.filter(m => m.status === 'in_progress').length,
    blockedMilestones: project.milestones.filter(m => m.status === 'blocked').length,
    totalSessions: project.sessionIds.length,
    completionPercentage: project.milestones.length > 0 
      ? Math.round((project.milestones.filter(m => m.status === 'complete').length / project.milestones.length) * 100)
      : 0,
  }
  
  const lines: string[] = [
    `# ${project.name}`,
    '',
    project.description,
    '',
    `**Status:** ${project.status}`,
    `**Progress:** ${summary.completionPercentage}% (${summary.completedMilestones}/${summary.totalMilestones} milestones)`,
    `**Sessions:** ${summary.totalSessions}`,
    '',
    '## Goals',
    ...project.goals.map(g => `- ${g}`),
    '',
    '## Milestones',
  ]
  
  for (const ms of project.milestones) {
    const statusIcon = ms.status === 'complete' ? '✅' :
                       ms.status === 'in_progress' ? '⏳' :
                       ms.status === 'blocked' ? '⛔' : '⏸️'
    lines.push(`${statusIcon} **${ms.name}** (${ms.status})`)
    if (ms.description) lines.push(`   ${ms.description}`)
    if (ms.assignedSessionIds.length > 0) {
      lines.push(`   Sessions: ${ms.assignedSessionIds.join(', ')}`)
    }
    lines.push('')
  }
  
  if (project.constraints.length > 0) {
    lines.push('## Constraints', ...project.constraints.map(c => `- ${c}`), '')
  }
  
  return lines.join('\n')
}

/**
 * Clear all projects (for testing)
 */
export async function clearAllProjects(): Promise<void> {
  const { readdir, unlink } = await import('fs/promises')
  
  try {
    const files = await readdir(PROJECTS_DIR)
    for (const file of files) {
      if (file.endsWith('.json')) {
        await unlink(join(PROJECTS_DIR, file))
      }
    }
    projectsCache.clear()
    logger.info('Cleared all projects')
  } catch (err: any) {
    logger.error(`Failed to clear projects: ${err.message}`)
  }
}
