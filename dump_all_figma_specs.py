import json
import os

def dump_node(node, out, depth=0):
    indent = "  " * depth
    n_type = node.get("type", "")
    n_name = node.get("name", "")
    text_content = ""
    if n_type == "TEXT":
        chars = node.get("characters", "").replace("\n", " ")
        text_content = f' -> "{chars}"'
    
    fills = node.get("fills", [])
    color_str = ""
    if fills and len(fills) > 0 and fills[0].get("type") == "SOLID" and "color" in fills[0]:
        c = fills[0]["color"]
        r, g, b = int(c.get("r", 0)*255), int(c.get("g", 0)*255), int(c.get("b", 0)*255)
        color_str = f" [#{r:02x}{g:02x}{b:02x}]"

    out.write(f"{indent}- [{n_type}] {n_name}{color_str}{text_content}\n")
    for child in node.get("children", []):
        dump_node(child, out, depth + 1)

def export_all_frames():
    with open("figma_design_specs.txt", "w", encoding="utf-8") as out:
        for fname in ["file1_raw.json", "file2_exec_audit.json", "file3_planner_plant.json"]:
            path = os.path.join("figma_dumps", fname)
            if not os.path.exists(path):
                continue
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            out.write(f"\n{'='*80}\n")
            out.write(f"FILE: {fname} (Doc: {data.get('name')})\n")
            out.write(f"{'='*80}\n")
            pages = data.get("document", {}).get("children", [])
            for p in pages:
                out.write(f"\nPAGE: {p.get('name')}\n")
                for frame in p.get("children", []):
                    out.write(f"\n--- FRAME: {frame.get('name')} (ID: {frame.get('id')}) ---\n")
                    dump_node(frame, out)

if __name__ == "__main__":
    export_all_frames()
    print("Exported all Figma frames to figma_design_specs.txt")
