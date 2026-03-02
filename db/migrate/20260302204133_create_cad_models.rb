class CreateCadModels < ActiveRecord::Migration[8.1]
  def change
    create_table :cad_models do |t|
      t.string :name
      t.text :description
      t.string :file_format

      t.timestamps
    end
  end
end
