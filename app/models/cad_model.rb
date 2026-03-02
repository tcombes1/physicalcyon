class CadModel < ApplicationRecord
  has_one_attached :file
  has_one_attached :gltf_file
  has_one_attached :thumbnail

  enum :status, { pending: 0, processing: 1, done: 2, failed: 3 }

  after_update_commit do
    broadcast_replace_to "cad_model_#{id}",
      target: "cad_model_status_#{id}",
      partial: "cad_models/status",
      locals: { cad_model: self }
  end
end
