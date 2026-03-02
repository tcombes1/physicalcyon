json.extract! cad_model, :id, :name, :description, :file_format, :created_at, :updated_at
json.url cad_model_url(cad_model, format: :json)
