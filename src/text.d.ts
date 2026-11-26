// Text imports (`with { type: "text" }`) of markdown files.
declare module "*.md" {
  const text: string;
  export default text;
}
