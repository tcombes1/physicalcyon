class AddConversionFieldsToCadModels < ActiveRecord::Migration[8.1]
  def change
    add_column :cad_models, :status, :integer, null: false, default: 0
    add_column :cad_models, :conversion_error, :text
  end
end
