// Parser de issues e pull requests do GitHub para modelos SquadTask.
import type { SquadTask } from '../../types';
import { checkNeedsHuman, extractPendingQuestions, resolveAgentRole, resolvePipelineStage } from '../../core/state-machine';

export interface RawGitHubLabel {
  name: string;
}

export interface RawGitHubAssignee {
  login: string;
}

export interface RawGitHubIssue {
  number: number;
  title: string;
  url: string;
  body?: string;
  labels?: RawGitHubLabel[];
  assignees?: RawGitHubAssignee[];
  createdAt: string;
  updatedAt: string;
}

export interface RawGitHubClosingRef {
  number: number;
}

export interface RawGitHubPR {
  number: number;
  title: string;
  url: string;
  headRefName?: string;
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  labels?: RawGitHubLabel[];
  closingIssuesReferences?: RawGitHubClosingRef[];
  body?: string;
  createdAt: string;
  updatedAt: string;
}

/** Extrai referências a issues fechadas a partir do corpo de um PR (ex: Closes #1171, Fixes #1171). */
export function extractClosingIssuesFromBody(body: string | undefined): number[] {
  if (!body) return [];
  const matches = body.matchAll(/(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s+#(\d+)/gi);
  const numbers: number[] = [];
  for (const m of matches) {
    const num = parseInt(m[1], 10);
    if (!isNaN(num) && !numbers.includes(num)) numbers.push(num);
  }
  return numbers;
}

/** Converte issues brutas e PRs do GitHub em uma lista estruturada de SquadTasks. */
export function parseGitHubTasks(repo: string, issues: RawGitHubIssue[], prs: RawGitHubPR[] = []): SquadTask[] {
  // Mapeia PRs vinculados a cada número de issue
  const prMap = new Map<number, RawGitHubPR>();

  for (const pr of prs) {
    const issueNumbers: number[] = [];
    if (pr.closingIssuesReferences) {
      for (const ref of pr.closingIssuesReferences) {
        if (!issueNumbers.includes(ref.number)) issueNumbers.push(ref.number);
      }
    }
    const fromBody = extractClosingIssuesFromBody(pr.body);
    for (const n of fromBody) {
      if (!issueNumbers.includes(n)) issueNumbers.push(n);
    }

    // Também verifica se a branch tem formato tipo/...-1171-...
    if (pr.headRefName) {
      const branchMatch = pr.headRefName.match(/[-/](\d+)(?:-|$)/);
      if (branchMatch) {
        const num = parseInt(branchMatch[1], 10);
        if (!isNaN(num) && !issueNumbers.includes(num)) issueNumbers.push(num);
      }
    }

    for (const num of issueNumbers) {
      if (!prMap.has(num)) prMap.set(num, pr);
    }
  }

  const tasks: SquadTask[] = [];
  const processedPrNumbers = new Set<number>();

  for (const issue of issues) {
    const labels = (issue.labels || []).map((l) => l.name);
    const linkedPr = prMap.get(issue.number);
    if (linkedPr) {
      processedPrNumbers.add(linkedPr.number);
    }

    let stage = resolvePipelineStage(labels);
    // Se há um PR aberto e o estágio ainda é ready-dev, promove para in-review ou testing
    if (linkedPr && stage === 'ready-dev') {
      stage = linkedPr.reviewDecision === 'APPROVED' ? 'testing' : 'in-review';
    }

    const assignedRole = resolveAgentRole(labels, stage);
    const questions = extractPendingQuestions(issue.body);
    const needsHuman = checkNeedsHuman(stage, labels, questions);

    const task: SquadTask = {
      id: `${repo}:${issue.number}`,
      number: issue.number,
      title: issue.title,
      url: issue.url,
      repo,
      stage,
      assignedRole,
      assignedUser: issue.assignees && issue.assignees.length > 0 ? issue.assignees[0].login : undefined,
      branch: linkedPr?.headRefName,
      prNumber: linkedPr?.number,
      prUrl: linkedPr?.url,
      prApproved: linkedPr?.reviewDecision === 'APPROVED',
      pendingQuestions: questions,
      needsHuman,
      createdAt: new Date(issue.createdAt).getTime() || Date.now(),
      updatedAt: new Date(issue.updatedAt).getTime() || Date.now(),
      labels,
    };

    tasks.push(task);
  }

  // Adiciona PRs avulsos (que não fecham nenhuma issue aberta no momento)
  for (const pr of prs) {
    if (processedPrNumbers.has(pr.number)) continue;
    const labels = (pr.labels || []).map((l) => l.name);
    let stage = resolvePipelineStage(labels);
    if (stage === 'inbox' || stage === 'ready-dev') {
      stage = pr.reviewDecision === 'APPROVED' ? 'testing' : 'in-review';
    }
    const assignedRole = resolveAgentRole(labels, stage);
    const questions = extractPendingQuestions(pr.body);
    const needsHuman = checkNeedsHuman(stage, labels, questions);

    tasks.push({
      id: `${repo}:pr-${pr.number}`,
      number: pr.number,
      title: pr.title,
      url: pr.url,
      repo,
      stage,
      assignedRole,
      branch: pr.headRefName,
      prNumber: pr.number,
      prUrl: pr.url,
      prApproved: pr.reviewDecision === 'APPROVED',
      pendingQuestions: questions,
      needsHuman,
      createdAt: new Date(pr.createdAt).getTime() || Date.now(),
      updatedAt: new Date(pr.updatedAt).getTime() || Date.now(),
      labels,
    });
  }

  return tasks;
}
