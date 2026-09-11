import ProjectNavigation from "../ProjectNavigation";
export default function ProjectDetailLayout({ children }: { children: React.ReactNode }) {
  return <><div className="project-detail-nav"><ProjectNavigation /></div>{children}</>;
}
