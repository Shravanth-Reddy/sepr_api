import json

def analyze_frame(node, depth=0):
    indent = "  " * depth
    n_type = node.get("type", "")
    n_name = node.get("name", "")
    text_content = ""
    if n_type == "TEXT":
        chars = node.get("characters", "").replace("\n", " ")
        text_content = f' -> "{chars[:60]}"'
    
    # Check fills / colors
    fills = node.get("fills", [])
    color_str = ""
    if fills and len(fills) > 0 and fills[0].get("type") == "SOLID" and "color" in fills[0]:
        c = fills[0]["color"]
        r, g, b = int(c.get("r", 0)*255), int(c.get("g", 0)*255), int(c.get("b", 0)*255)
        color_str = f" [#{r:02x}{g:02x}{b:02x}]"

    print(f"{indent}- [{n_type}] {n_name}{color_str}{text_content}")
    for child in node.get("children", [])[:15]:
        analyze_frame(child, depth + 1)

def inspect_frame_by_name(file_path, frame_name):
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    pages = data.get("document", {}).get("children", [])
    for p in pages:
        for frame in p.get("children", []):
            if frame_name.lower() in frame.get("name", "").lower():
                print(f"\n=======================================================")
                print(f"FRAME: {frame.get('name')} (ID: {frame.get('id')})")
                print(f"=======================================================")
                analyze_frame(frame)
                return

if __name__ == "__main__":
    print("=== INSPECTING SUPPLY PLANNER CONTROL ROOM ===")
    inspect_frame_by_name("figma_dumps/file3_planner_plant.json", "Supply Planner Control Room")
    print("\n=== INSPECTING PLANT OPERATIONS DEFAULT ===")
    inspect_frame_by_name("figma_dumps/file3_planner_plant.json", "Plant Operations – Default")
    print("\n=== INSPECTING EXECUTIVE REVIEW DEFAULT ===")
    inspect_frame_by_name("figma_dumps/file2_exec_audit.json", "Executive review – Default")
    print("\n=== INSPECTING DECISION AUDIT CENTER ===")
    inspect_frame_by_name("figma_dumps/file2_exec_audit.json", "Decision Audit Center")
