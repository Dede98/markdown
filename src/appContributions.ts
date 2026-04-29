import type { ReactNode } from "react";
import type { DocumentSession } from "./documentSession";
import type { EditorContribution } from "./editorContributions";

export type AppContributionContext = {
  session: DocumentSession;
  markdown: string;
  raw: boolean;
  zen: boolean;
  dirty: boolean;
};

export type PanelContribution = {
  id: string;
  label: string;
  placement: "right";
  render: (context: AppContributionContext) => ReactNode;
};

export type SettingsContribution = {
  id: string;
  title: string;
  render: (context: AppContributionContext) => ReactNode;
};

export type StatusContribution = {
  id: string;
  render: (context: AppContributionContext) => ReactNode;
};

export type DocumentLifecycleHooks = {
  onSessionStarted?: (session: DocumentSession) => void;
  onSessionEnded?: (session: DocumentSession) => void;
  onMaterializeMarkdown?: (session: DocumentSession) => string | null;
};

export type AppContribution = {
  id: string;
  editor?: EditorContribution;
  panels?: PanelContribution[];
  settings?: SettingsContribution[];
  statusItems?: StatusContribution[];
  documentLifecycle?: DocumentLifecycleHooks;
};

export function collectEditorContributions(contributions: AppContribution[]) {
  return contributions.flatMap((contribution) => (contribution.editor ? [contribution.editor] : []));
}

export function collectPanelContributions(contributions: AppContribution[]) {
  return contributions.flatMap((contribution) => contribution.panels ?? []);
}

export function collectSettingsContributions(contributions: AppContribution[]) {
  return contributions.flatMap((contribution) => contribution.settings ?? []);
}

export function collectStatusContributions(contributions: AppContribution[]) {
  return contributions.flatMap((contribution) => contribution.statusItems ?? []);
}

