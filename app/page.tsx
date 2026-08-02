import RoleFitClient, { type ProjectState } from "./rolefit-client";
import { getProjectState, listProjectFiles, readProjectText } from "../lib/project";

export const dynamic = "force-dynamic";

export default async function Home() {
  const project = await getProjectState();
  const files = project.exists ? await listProjectFiles(project.directory, project.mainFile) : [];
  let initialResume = "";
  if (project.exists && files.some((file) => file.path === project.mainFile)) {
    try { initialResume = await readProjectText(project.directory, project.mainFile); }
    catch { /* The client will surface project read errors through the normal API flow. */ }
  }
  const initialProject: ProjectState = {
    exists: project.exists,
    source: project.source,
    mainFile: project.mainFile,
    files,
  };
  return <RoleFitClient initialProject={initialProject} initialResume={initialResume} />;
}
