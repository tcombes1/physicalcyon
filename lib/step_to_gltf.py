#!/usr/bin/env python3
"""
Convert a STEP file to glTF 2.0 using pythonocc-core.

Usage: python3 step_to_gltf.py <input.step> <output.gltf> <output.png>

Exit 0 on success, non-zero on error. All diagnostic output goes to stderr.
"""

import sys
import json
import struct
import base64
import math

def die(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


def read_step(step_path):
    try:
        from OCC.Core.STEPControl import STEPControl_Reader
        from OCC.Core.IFSelect import IFSelect_RetDone
    except ImportError:
        die("pythonocc-core is not installed. Run: pip install pythonocc-core")

    reader = STEPControl_Reader()
    status = reader.ReadFile(step_path)
    if status != IFSelect_RetDone:
        die(f"Failed to read STEP file: {step_path}")
    reader.TransferRoots()
    return reader.OneShape()


def loc_to_trsf(loc):
    """
    Convert a TopLoc_Location to a gp_Trsf by walking the datum chain.

    A TopLoc_Location is a linked list of (TopLoc_Datum3D, power) pairs.
    Each datum wraps a gp_Trsf. We multiply them left-to-right to get the
    effective transformation.
    """
    from OCC.Core.gp import gp_Trsf
    result = gp_Trsf()          # identity
    current = loc
    while not current.IsIdentity():
        datum_trsf = current.FirstDatum().Trsf()
        power      = current.FirstPower()
        if power == -1:
            datum_trsf.Invert()
        elif power != 1:
            # Rare – repeated compositions; approximate with a single datum
            print(f"Warning: location power {power} not handled, using power=1",
                  file=sys.stderr)
        result.Multiply(datum_trsf)
        current = current.NextLocation()
    return result


def tessellate(shape):
    from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh
    from OCC.Core.TopExp import TopExp_Explorer
    from OCC.Core.TopAbs import TopAbs_FACE
    from OCC.Core.BRep import BRep_Tool
    from OCC.Core.TopLoc import TopLoc_Location

    # Tessellate with 0.1 mm linear deflection, 0.5 deg angular deflection
    mesh = BRepMesh_IncrementalMesh(shape, 0.1, False, 0.5, True)
    mesh.Perform()

    positions = []   # flat list of floats: x, y, z per vertex
    indices = []     # flat list of ints: triangle vertex indices

    vertex_offset = 0
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        face = explorer.Current()
        loc  = TopLoc_Location()
        triangulation = BRep_Tool.Triangulation(face, loc)

        if triangulation is not None:
            n_nodes = triangulation.NbNodes()
            n_tris  = triangulation.NbTriangles()

            # Build the effective gp_Trsf for this face's location.
            # Nodes from the triangulation are in the face's LOCAL coordinate
            # system; applying the location transforms them to global coords.
            trsf = None if loc.IsIdentity() else loc_to_trsf(loc)

            for i in range(1, n_nodes + 1):
                node = triangulation.Node(i)
                if trsf is not None:
                    node = node.Transformed(trsf)
                positions.extend([node.X(), node.Y(), node.Z()])

            for i in range(1, n_tris + 1):
                tri = triangulation.Triangle(i)
                n1, n2, n3 = tri.Get()
                indices.extend([
                    vertex_offset + n1 - 1,
                    vertex_offset + n2 - 1,
                    vertex_offset + n3 - 1,
                ])

            vertex_offset += n_nodes

        explorer.Next()

    return positions, indices


def build_gltf(positions, indices):
    """Build a minimal glTF 2.0 dict with embedded base64 binary buffers."""

    if not positions or not indices:
        die("No geometry found in STEP file after tessellation.")

    # Pack positions as float32 little-endian
    pos_data = struct.pack(f"<{len(positions)}f", *positions)
    # Pack indices as uint32 little-endian
    idx_data = struct.pack(f"<{len(indices)}I", *indices)

    # Combine into one buffer
    buffer_data = pos_data + idx_data
    buffer_b64 = base64.b64encode(buffer_data).decode("ascii")
    buffer_uri = f"data:application/octet-stream;base64,{buffer_b64}"

    n_vertices = len(positions) // 3
    n_indices  = len(indices)

    # Compute bounding box for accessor min/max
    xs = positions[0::3]
    ys = positions[1::3]
    zs = positions[2::3]
    pos_min = [min(xs), min(ys), min(zs)]
    pos_max = [max(xs), max(ys), max(zs)]

    pos_byte_length = len(pos_data)
    idx_byte_length = len(idx_data)

    gltf = {
        "asset": {"version": "2.0", "generator": "step_to_gltf.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{
            "primitives": [{
                "attributes": {"POSITION": 0},
                "indices": 1,
                "material": 0,
                "mode": 4  # TRIANGLES
            }]
        }],
        "materials": [{
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.8, 0.8, 0.8, 1.0],
                "metallicFactor": 0.1,
                "roughnessFactor": 0.8
            },
            "doubleSided": True
        }],
        "accessors": [
            {
                "bufferView": 0,
                "byteOffset": 0,
                "componentType": 5126,  # FLOAT
                "count": n_vertices,
                "type": "VEC3",
                "min": pos_min,
                "max": pos_max
            },
            {
                "bufferView": 1,
                "byteOffset": 0,
                "componentType": 5125,  # UNSIGNED_INT
                "count": n_indices,
                "type": "SCALAR"
            }
        ],
        "bufferViews": [
            {
                "buffer": 0,
                "byteOffset": 0,
                "byteLength": pos_byte_length,
                "target": 34962  # ARRAY_BUFFER
            },
            {
                "buffer": 0,
                "byteOffset": pos_byte_length,
                "byteLength": idx_byte_length,
                "target": 34963  # ELEMENT_ARRAY_BUFFER
            }
        ],
        "buffers": [{
            "uri": buffer_uri,
            "byteLength": len(buffer_data)
        }]
    }

    return gltf


def write_thumbnail(shape, thumb_path):
    """
    Attempt to render an offscreen thumbnail. Falls back to a 1×1 white PNG
    if OpenGL/Mesa is unavailable (headless server).
    """
    FALLBACK_PNG = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff"
        b"\x3f\x00\x05\xfe\x02\xfe\xdc\xccY\xe7\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    try:
        from OCC.Display.SimpleGui import init_display
        # Try to initialise offscreen display; this will fail on headless servers
        display, start_display, add_menu, add_function_to_menu = init_display(
            "offscreen", size=(512, 512), display_triedron=False
        )
        display.DisplayShape(shape, update=True)
        display.FitAll()
        display.View.Dump(thumb_path)
        return
    except Exception as e:
        print(f"Offscreen render unavailable, writing fallback PNG: {e}", file=sys.stderr)

    with open(thumb_path, "wb") as f:
        f.write(FALLBACK_PNG)


def main():
    if len(sys.argv) != 4:
        die(f"Usage: {sys.argv[0]} <input.step> <output.gltf> <output.png>")

    step_path, gltf_path, thumb_path = sys.argv[1], sys.argv[2], sys.argv[3]

    print(f"Reading STEP: {step_path}", file=sys.stderr)
    shape = read_step(step_path)

    print("Tessellating…", file=sys.stderr)
    positions, indices = tessellate(shape)
    print(f"  {len(positions)//3} vertices, {len(indices)//3} triangles", file=sys.stderr)

    print("Building glTF…", file=sys.stderr)
    gltf = build_gltf(positions, indices)

    with open(gltf_path, "w") as f:
        json.dump(gltf, f)
    print(f"glTF written to {gltf_path}", file=sys.stderr)

    print("Writing thumbnail…", file=sys.stderr)
    write_thumbnail(shape, thumb_path)
    print(f"Thumbnail written to {thumb_path}", file=sys.stderr)

    print("Done.", file=sys.stderr)
    sys.exit(0)


if __name__ == "__main__":
    main()
