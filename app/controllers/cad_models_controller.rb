class CadModelsController < ApplicationController
  before_action :set_cad_model, only: %i[ show edit update destroy ]

  # GET /cad_models or /cad_models.json
  def index
    @cad_models = CadModel.all
  end

  # GET /cad_models/1 or /cad_models/1.json
  def show
  end

  # GET /cad_models/new
  def new
    @cad_model = CadModel.new
  end

  # GET /cad_models/1/edit
  def edit
  end

  # POST /cad_models or /cad_models.json
  def create
    @cad_model = CadModel.new(cad_model_params)

    respond_to do |format|
      if @cad_model.save
        ConvertStepJob.perform_later(@cad_model.id)
        format.html { redirect_to @cad_model, notice: "Cad model was successfully created." }
        format.json { render :show, status: :created, location: @cad_model }
      else
        format.html { render :new, status: :unprocessable_entity }
        format.json { render json: @cad_model.errors, status: :unprocessable_entity }
      end
    end
  end

  # PATCH/PUT /cad_models/1 or /cad_models/1.json
  def update
    respond_to do |format|
      if @cad_model.update(cad_model_params)
        format.html { redirect_to @cad_model, notice: "Cad model was successfully updated.", status: :see_other }
        format.json { render :show, status: :ok, location: @cad_model }
      else
        format.html { render :edit, status: :unprocessable_entity }
        format.json { render json: @cad_model.errors, status: :unprocessable_entity }
      end
    end
  end

  # DELETE /cad_models/1 or /cad_models/1.json
  def destroy
    @cad_model.destroy!

    respond_to do |format|
      format.html { redirect_to cad_models_path, notice: "Cad model was successfully destroyed.", status: :see_other }
      format.json { head :no_content }
    end
  end

  private
    # Use callbacks to share common setup or constraints between actions.
    def set_cad_model
      @cad_model = CadModel.find(params.expect(:id))
    end

    # Only allow a list of trusted parameters through.
    def cad_model_params
      params.expect(cad_model: [ :name, :description, :file_format, :file ])
    end
end
