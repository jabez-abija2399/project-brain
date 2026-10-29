import { listProjects } from "../../server/projects";

export default async function ProjectsPage() {
  const projects = await listProjects();
  return <ul>{projects.map((p) => <li key={p}>{p}</li>)}</ul>;
}
