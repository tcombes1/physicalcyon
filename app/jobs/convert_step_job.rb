require "open3"
require "tempfile"

class ConvertStepJob < ApplicationJob
  queue_as :default

  def perform(cad_model_id)
    cad_model = CadModel.find(cad_model_id)
    cad_model.processing!

    step_tmp   = Tempfile.new([ "step_input", ".step" ])
    gltf_tmp   = Tempfile.new([ "gltf_output", ".glb" ])
    thumb_tmp  = Tempfile.new([ "thumb_output", ".png" ])

    begin
      # Download attached STEP file
      step_tmp.binmode
      step_tmp.write(cad_model.file.download)
      step_tmp.flush

      script = Rails.root.join("lib/step_to_gltf.py").to_s

      python = File.expand_path("~/miniconda3/bin/python3")
      stdout, stderr, status = Open3.capture3(
        python, script,
        step_tmp.path, gltf_tmp.path, thumb_tmp.path
      )

      unless status.success?
        cad_model.update!(status: :failed, conversion_error: stderr.presence || stdout)
        return
      end

      cad_model.gltf_file.attach(
        io: File.open(gltf_tmp.path),
        filename: "#{cad_model.id}.glb",
        content_type: "model/gltf-binary"
      )

      if File.size(thumb_tmp.path) > 0
        cad_model.thumbnail.attach(
          io: File.open(thumb_tmp.path),
          filename: "#{cad_model.id}.png",
          content_type: "image/png"
        )
      end

      cad_model.done!
    rescue => e
      cad_model.update!(status: :failed, conversion_error: e.message)
      raise
    ensure
      step_tmp.close!
      gltf_tmp.close!
      thumb_tmp.close!
    end
  end
end
