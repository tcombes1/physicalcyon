#!/usr/bin/env python3
"""
Convert a STEP file to glTF 2.0 using pythonocc-core.

Uses OCCT's XDE framework (STEPCAFControl_Reader + RWGltf_CafWriter) for
correct handling of multi-product assemblies including ITEM_DEFINED_TRANSFORMATION,
PRODUCT_DEFINITION_PLACEMENT, and NEXT_ASSEMBLY_USAGE_OCCURRENCE.

Usage: python3 step_to_gltf.py <input.step> <output.gltf> <output.png>

Exit 0 on success, non-zero on error. All diagnostic output goes to stderr.
"""

import sys


def die(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


def convert_step_to_gltf(step_path, gltf_path):
    try:
        from OCC.Core.STEPCAFControl import STEPCAFControl_Reader
        from OCC.Core.XCAFDoc import XCAFDoc_DocumentTool
        from OCC.Core.TDocStd import TDocStd_Document
        from OCC.Core.TDF import TDF_LabelSequence
        from OCC.Core.BRep import BRep_Builder
        from OCC.Core.TopoDS import TopoDS_Compound
        from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh
        from OCC.Core.BRepTools import breptools
        from OCC.Core.TColStd import TColStd_IndexedDataMapOfStringString
        from OCC.Core.TCollection import TCollection_AsciiString
        from OCC.Core.RWGltf import RWGltf_CafWriter
        from OCC.Core.Message import Message_ProgressRange
        from OCC.Core.IFSelect import IFSelect_RetDone
    except ImportError as e:
        die(f"pythonocc-core is not installed or missing module: {e}")

    # Read STEP into an XDE document. STEPCAFControl_Reader correctly processes
    # NEXT_ASSEMBLY_USAGE_OCCURRENCE, ITEM_DEFINED_TRANSFORMATION, and
    # PRODUCT_DEFINITION_PLACEMENT to build a proper assembly hierarchy.
    doc = TDocStd_Document("step-to-gltf")
    shape_tool = XCAFDoc_DocumentTool.ShapeTool(doc.Main())

    reader = STEPCAFControl_Reader()
    reader.SetColorMode(True)
    reader.SetNameMode(True)
    reader.SetLayerMode(True)

    status = reader.ReadFile(step_path)
    if status != IFSelect_RetDone:
        die(f"Failed to read STEP file: {step_path}")

    reader.Transfer(doc)

    free_labels = TDF_LabelSequence()
    shape_tool.GetFreeShapes(free_labels)
    print(f"  {free_labels.Length()} top-level shape(s) in assembly", file=sys.stderr)

    # Build a compound from the free shapes to tessellate. Shapes retrieved from
    # shape_tool share the underlying TShape objects with the document, so
    # tessellation updates are reflected in the document's shape data.
    compound = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(compound)
    for i in range(1, free_labels.Length() + 1):
        shape = shape_tool.GetShape(free_labels.Value(i))
        builder.Add(compound, shape)

    # Tessellate: 0.1 mm linear deflection, 0.5° angular deflection.
    print("Tessellating…", file=sys.stderr)
    breptools.Clean(compound)
    mesh = BRepMesh_IncrementalMesh(compound, 0.1, False, 0.5, True)
    mesh.Perform()

    # Write glTF. RWGltf_CafWriter reads directly from the XDE document, so it
    # correctly outputs the assembly hierarchy and all component placements.
    print(f"Writing glTF: {gltf_path}", file=sys.stderr)
    binary = gltf_path.lower().endswith(".glb")
    writer = RWGltf_CafWriter(gltf_path, binary)

    file_info = TColStd_IndexedDataMapOfStringString()
    file_info.Add(
        TCollection_AsciiString("Generator"),
        TCollection_AsciiString("physicalcyon/step_to_gltf.py"),
    )

    ok = writer.Perform(doc, file_info, Message_ProgressRange())
    if not ok:
        die("RWGltf_CafWriter failed to write glTF")


def write_thumbnail(thumb_path):
    """Write a 1×1 white PNG placeholder (offscreen rendering not available)."""
    FALLBACK_PNG = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff"
        b"\x3f\x00\x05\xfe\x02\xfe\xdc\xccY\xe7\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    with open(thumb_path, "wb") as f:
        f.write(FALLBACK_PNG)


def main():
    if len(sys.argv) != 4:
        die(f"Usage: {sys.argv[0]} <input.step> <output.gltf> <output.png>")

    step_path, gltf_path, thumb_path = sys.argv[1], sys.argv[2], sys.argv[3]

    print(f"Reading STEP: {step_path}", file=sys.stderr)
    convert_step_to_gltf(step_path, gltf_path)
    print(f"glTF written to {gltf_path}", file=sys.stderr)

    print("Writing thumbnail…", file=sys.stderr)
    write_thumbnail(thumb_path)
    print(f"Thumbnail written to {thumb_path}", file=sys.stderr)

    print("Done.", file=sys.stderr)
    sys.exit(0)


if __name__ == "__main__":
    main()
